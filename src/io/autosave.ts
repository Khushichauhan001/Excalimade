// Local autosave: gzip'd scene JSON + image blobs in IndexedDB, restored on startup, synced across tabs.
import { useStore, getState, showToast } from "../core/store";
import type { AppState, BinaryFile, ExcalidrawElement, ImageElement } from "../core/types";
import { on } from "../core/events";
import { gzip, gunzip, base64ToBytes } from "../core/utils";
import { isCollabUrl, shouldPauseAutosave } from "../collab/api";
import { idbGet, idbKeys, idbPutMany, isQuotaError } from "./idb";
import { repo, loadOrCreateMeta, type WorkspaceMeta } from "../workspace/repo";
import { serializeSceneObject, parseScene, applyScene, pickPersistedAppState, type RestoredScene } from "./serialize";
import { PERSISTED_APPSTATE_KEYS } from "../core/store";

const SAVE_DELAY = 500;
/** Files written less than this long ago are never garbage-collected (another tab may be mid-save). */
const GC_GRACE_MS = 5 * 60_000;

interface StoredScene {
  data: Uint8Array; // gzip(JSON scene without files)
  updated: number;
  tab: string;
}
interface StoredFile {
  id: string;
  mimeType: string;
  created: number;
  savedAt: number;
  blob: Blob;
}

const TAB_ID = Math.random().toString(36).slice(2);
const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("excalimade-scene") : null;

/** Collab rooms and share links own their scene — never persist them locally. */
export const isSharedUrl = () => typeof location !== "undefined" && (/^#(room|json)=/.test(location.hash) || isCollabUrl());
const autosaveDisabled = () => isSharedUrl() || shouldPauseAutosave();

// ---- helpers ---------------------------------------------------------------------------------

const dataURLToBlob = (dataURL: string) => {
  const comma = dataURL.indexOf(",");
  const meta = dataURL.slice(5, comma);
  const mime = meta.split(";")[0] || "application/octet-stream";
  const body = dataURL.slice(comma + 1);
  const bytes = meta.endsWith(";base64") ? base64ToBytes(body) : new TextEncoder().encode(decodeURIComponent(body));
  return new Blob([bytes as BlobPart], { type: mime });
};
const blobToDataURL = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

const referencedFileIds = (elements: readonly ExcalidrawElement[]) =>
  new Set(elements.filter((e) => e.type === "image" && !e.isDeleted).map((e) => (e as ImageElement).fileId));

/** Scene (workspace node id) that autosave reads from and writes to. */
let activeSceneId: string | null = null;
export const getActiveSceneId = () => activeSceneId;
let metaPromise: Promise<WorkspaceMeta> | null = null;
/** Workspace tree as loaded at startup (migrates single-scene data on first run). */
export const getInitialMeta = () => (metaPromise ??= loadOrCreateMeta());

async function readStoredScene(id = activeSceneId): Promise<{ scene: RestoredScene; updated: number } | null> {
  if (!id) return null;
  const rec = await repo.readScene(id);
  if (!rec) return null;
  const scene = parseScene(await gunzip(rec.data));
  const ids = referencedFileIds(scene.elements);
  const files: Record<string, BinaryFile> = {};
  await Promise.all(
    [...ids].map(async (id) => {
      const f = await idbGet<StoredFile>("files", id);
      if (f) files[id] = { id, mimeType: f.mimeType, created: f.created, dataURL: await blobToDataURL(f.blob) };
    }),
  );
  scene.files = files;
  return { scene, updated: rec.updated };
}

// ---- restore -----------------------------------------------------------------------------------

let prefetch: Promise<{ scene: RestoredScene; updated: number } | null> | null = null;
let prefetched: { scene: RestoredScene; updated: number } | null | undefined; // undefined = still loading
let restored = false;
let externalSceneLoaded = false;
let applyingLocal = false;
let lastStoredUpdate = 0;

on("sceneLoaded", ({ source }) => {
  if (source !== "local") externalSceneLoaded = true;
});

/** Start reading the stored scene as early as possible (module load), so it's ready before first paint. */
export function prefetchLocal() {
  if (!prefetch) {
    prefetch = getInitialMeta()
      .then((meta) => {
        activeSceneId = meta.activeId;
        return readStoredScene();
      })
      .catch((e) => {
        console.warn("Local scene could not be read", e);
        return null;
      })
      .then((r) => (prefetched = r));
  }
  return prefetch;
}
if (typeof indexedDB !== "undefined") void prefetchLocal();

/** True while the stored scene is still being read (UI shows a blank cover to avoid flashing). */
export const isRestorePending = () => !restored && prefetched === undefined;

function applyLocal(data: { scene: RestoredScene; updated: number } | null) {
  if (restored) return;
  restored = true;
  if (!data) return;
  lastStoredUpdate = data.updated;
  if (externalSceneLoaded || autosaveDisabled()) {
    // keep the user's preferences even when the scene comes from elsewhere
    const { theme, username } = data.scene.appState;
    getState().setAppState({ ...(theme ? { theme } : {}), ...(username ? { username } : {}) });
    return;
  }
  applyingLocal = true;
  try {
    applyScene(data.scene, "local", { applyPreferences: true, fit: false });
  } finally {
    applyingLocal = false;
  }
  lastSnapshot = snapshot();
  setTimeout(() => void collectGarbage(), 3000);
}

/** Apply synchronously if the prefetch already finished; returns false if still pending. */
export function restoreFromLocalSync(): boolean {
  if (restored) return true;
  if (prefetched === undefined) return false;
  applyLocal(prefetched);
  return true;
}

/** Restore the autosaved scene (elements + persisted appState + files). Safe to call more than once. */
export async function restoreFromLocal(): Promise<void> {
  if (restored) return;
  const data = await prefetchLocal();
  applyLocal(data);
}

/** Delete stored images that no scene in the workspace references any more. */
async function collectGarbage() {
  try {
    const keep = referencedFileIds(getState().elements);
    for (const [, rec] of await repo.allScenes()) {
      try {
        for (const id of referencedFileIds(parseScene(await gunzip(rec.data)).elements)) keep.add(id);
      } catch {
        return; // never delete images if any scene can't be read
      }
    }
    const keys = await idbKeys("files");
    const now = Date.now();
    const stale: string[] = [];
    for (const k of keys) {
      if (keep.has(k)) continue;
      const f = await idbGet<StoredFile>("files", k);
      if (!f || now - (f.savedAt ?? 0) > GC_GRACE_MS) stale.push(k);
    }
    await idbPutMany("files", [], stale);
    savedFileIds = new Set(keys.filter((k) => !stale.includes(k)));
  } catch (e) {
    console.warn("File GC failed", e);
  }
}

// ---- save --------------------------------------------------------------------------------------

let savedFileIds: Set<string> | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let dirty = false;
let pendingRemote = false;
let quotaWarned = false;

type Snapshot = { elements: ExcalidrawElement[]; files: object; app: string };
let lastSnapshot: Snapshot | null = null;
const persistedKey = (as: AppState) => PERSISTED_APPSTATE_KEYS.map((k) => as[k]).join("\u0001");
const snapshot = (): Snapshot => {
  const s = getState();
  return { elements: s.elements, files: s.files, app: persistedKey(s.appState) };
};

export async function saveToLocalNow() {
  clearTimeout(timer);
  if (!dirty || autosaveDisabled() || !restored || !activeSceneId) return;
  dirty = false;
  const scene = serializeSceneObject({ compat: false });
  const { files, ...withoutFiles } = scene;
  try {
    if (!savedFileIds) savedFileIds = new Set(await idbKeys("files"));
    const now = Date.now();
    const newFiles = Object.values(files).filter((f) => !savedFileIds!.has(f.id));
    if (newFiles.length) {
      await idbPutMany(
        "files",
        newFiles.map((f) => [f.id, { id: f.id, mimeType: f.mimeType, created: f.created, savedAt: now, blob: dataURLToBlob(f.dataURL) } satisfies StoredFile]),
      );
      newFiles.forEach((f) => savedFileIds!.add(f.id));
    }
    const rec: StoredScene = { data: await gzip(JSON.stringify(withoutFiles)), updated: now, tab: TAB_ID };
    await repo.writeScene(activeSceneId, rec);
    lastStoredUpdate = now;
    pendingRemote = false;
    channel?.postMessage({ type: "saved", tab: TAB_ID, updated: now, sceneId: activeSceneId });
  } catch (e) {
    dirty = true;
    if (isQuotaError(e)) {
      if (!quotaWarned) showToast("Browser storage is full — your drawing isn't being saved locally. Save it to a file.", "error");
      quotaWarned = true;
    } else {
      console.error("Autosave failed", e);
    }
  }
}

function schedule() {
  dirty = true;
  clearTimeout(timer);
  timer = setTimeout(() => void saveToLocalNow(), SAVE_DELAY);
}

async function reloadFromStorage() {
  if (autosaveDisabled()) return;
  try {
    const data = await readStoredScene();
    if (!data || data.updated <= lastStoredUpdate) return;
    lastStoredUpdate = data.updated;
    pendingRemote = false;
    const keepViewport = pickPersistedAppState(getState().appState);
    applyingLocal = true;
    try {
      applyScene(
        { ...data.scene, appState: { ...data.scene.appState, scrollX: keepViewport.scrollX, scrollY: keepViewport.scrollY, zoom: keepViewport.zoom } },
        "local",
        { applyPreferences: true, fit: false },
      );
    } finally {
      applyingLocal = false;
    }
    lastSnapshot = snapshot();
  } catch (e) {
    console.warn("Tab sync failed", e);
  }
}

const isIdle = () => document.hidden || !document.hasFocus();

let started = false;
/** Subscribe to store changes and persist them. Returns a stop function. */
export function startAutosave() {
  if (started) return () => {};
  started = true;
  lastSnapshot = snapshot();
  const unsub = useStore.subscribe((s) => {
    if (applyingLocal || !restored) return;
    const prev = lastSnapshot;
    const next = { elements: s.elements, files: s.files, app: prev?.app ?? "" };
    if (prev && prev.elements === next.elements && prev.files === next.files) {
      // appState-only change: only persisted keys matter (and not while presenting)
      if (s.appState.presentationMode) return;
      const key = persistedKey(s.appState);
      if (key === prev.app) return;
      next.app = key;
    } else next.app = persistedKey(s.appState);
    lastSnapshot = next;
    schedule();
  });
  const onMessage = (e: MessageEvent) => {
    if (e.data?.type !== "saved" || e.data.tab === TAB_ID || e.data.sceneId !== activeSceneId) return;
    if (isIdle() && !dirty) void reloadFromStorage();
    else pendingRemote = true;
  };
  const onWake = () => {
    if (!document.hidden && pendingRemote && !dirty) void reloadFromStorage();
  };
  const onHide = () => {
    if (document.hidden) void saveToLocalNow();
  };
  const onPageHide = () => void saveToLocalNow();
  channel?.addEventListener("message", onMessage);
  window.addEventListener("focus", onWake);
  document.addEventListener("visibilitychange", onHide);
  document.addEventListener("visibilitychange", onWake);
  window.addEventListener("pagehide", onPageHide);
  return () => {
    started = false;
    unsub();
    channel?.removeEventListener("message", onMessage);
    window.removeEventListener("focus", onWake);
    document.removeEventListener("visibilitychange", onHide);
    document.removeEventListener("visibilitychange", onWake);
    window.removeEventListener("pagehide", onPageHide);
  };
}

// ---- workspace scene switching -------------------------------------------------------------------

const PREFERENCE_KEYS = new Set(["theme", "username"]);

/**
 * Make `id` the scene autosave works on.
 * - load: true  → save the current scene, then load `id` into the editor.
 * - load: false → keep the canvas as it is and store it as `id` (e.g. "save a copy to my workspace").
 * Set `saveCurrent: false` when the current scene was just deleted.
 */
export async function switchScene(id: string, opts: { load: boolean; saveCurrent?: boolean; title?: string }) {
  clearTimeout(timer);
  if (opts.saveCurrent !== false && activeSceneId) await saveToLocalNow();
  else dirty = false;
  activeSceneId = id;
  if (!opts.load) {
    if (opts.title) getState().setAppState({ name: opts.title });
    lastSnapshot = snapshot();
    dirty = true;
    await saveToLocalNow();
    return;
  }
  const data = await readStoredScene(id).catch(() => null);
  if (activeSceneId !== id) return; // switched again meanwhile
  applyingLocal = true;
  try {
    if (data) {
      const appState = Object.fromEntries(
        Object.entries(data.scene.appState).filter(([k]) => !PREFERENCE_KEYS.has(k) && !k.startsWith("currentItem")),
      );
      applyScene({ ...data.scene, appState: { ...appState, ...(opts.title ? { name: opts.title } : {}) } }, "local", { applyPreferences: false, fit: false });
    } else {
      applyScene({ elements: [], files: {}, appState: { scrollX: 0, scrollY: 0, zoom: 1, ...(opts.title ? { name: opts.title } : {}) } }, "local", { applyPreferences: false, fit: false });
    }
  } finally {
    applyingLocal = false;
  }
  lastStoredUpdate = data?.updated ?? 0;
  lastSnapshot = snapshot();
}

/** Read any stored scene (elements, appState and its images) — used by workspace export/duplicate. */
export async function readSceneWithFiles(id: string): Promise<RestoredScene | null> {
  if (id === activeSceneId) await saveToLocalNow();
  return (await readStoredScene(id))?.scene ?? null;
}

/** Store a complete scene (with images) under a workspace id without loading it into the editor. */
export async function writeSceneWithFiles(id: string, scene: RestoredScene) {
  const now = Date.now();
  const files = Object.values(scene.files ?? {});
  if (files.length) {
    await idbPutMany(
      "files",
      files.map((f) => [f.id, { id: f.id, mimeType: f.mimeType, created: f.created, savedAt: now, blob: dataURLToBlob(f.dataURL) } satisfies StoredFile]),
    );
    savedFileIds?.clear();
    savedFileIds = null;
  }
  const { files: _files, ...rest } = { type: "excalidraw", version: 2, source: "excalimade", ...scene };
  await repo.writeScene(id, { data: await gzip(JSON.stringify(rest)), updated: now, tab: TAB_ID });
}
