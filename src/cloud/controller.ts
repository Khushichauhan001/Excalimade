// Cloud scene lifecycle: session, open/attach/detach, debounced autosave, persistent collab rooms,
// version preview/restore, comments + notifications refresh, URL hash handling.
import { getState, useStore, showToast, getNonDeletedElements } from "../core/store";
import type { AppState, BinaryFiles, ExcalidrawElement } from "../core/types";
import { on } from "../core/events";
import { startCollab, stopCollab, isCollaborating } from "../collab/api";
import { Api, ApiError } from "./api";
import { cloud, setCloud, type CloudModal, type SceneMeta, type VersionInfo } from "./session";
import { applyCloudScene, bumpForRestore, contentSignature, makeThumbnail, parseCloudScene, serializeCloudScene } from "./sceneio";

const AUTOSAVE_DELAY = 2000;
const THUMB_INTERVAL = 30_000;

let lastSig: string | null = null;
let lastThumbAt = 0;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let retryTimer: ReturnType<typeof setInterval> | undefined;
let inFlight: Promise<void> | null = null;
let again = false;
let paused = false;
let collabOwned = false;
let collabPausedForPreview = false;
let unsubStore: (() => void) | null = null;
let stash: { elements: ExcalidrawElement[]; files: BinaryFiles; appState: Partial<AppState> } | null = null;
let opening: string | null = null;

// ---- modals (promise based) ------------------------------------------------------------------

export const openModal = (modal: CloudModal | null) => setCloud({ modal });

export const confirmDialog = (opts: { title: string; message: string; confirmLabel: string; danger?: boolean; extraLabel?: string }) =>
  new Promise<boolean | "extra">((resolve) => openModal({ kind: "confirm", ...opts, resolve }));

export const promptDialog = (opts: { title: string; label: string; initial?: string; confirmLabel?: string }) =>
  new Promise<string | null>((resolve) =>
    openModal({ kind: "prompt", title: opts.title, label: opts.label, initial: opts.initial ?? "", confirmLabel: opts.confirmLabel ?? "Save", resolve }),
  );

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");
export const toastError = (e: unknown) => showToast(errorMessage(e), "error");

// ---- session -----------------------------------------------------------------------------------

export async function loadSession() {
  try {
    const { user } = await Api.me();
    setCloud({ user, userLoaded: true });
  } catch {
    setCloud({ userLoaded: true });
  }
}

/** After sign-in / sign-up: refresh the open scene's permissions and continue whatever was pending. */
export async function onSignedIn() {
  const { pending, scene, token } = cloud();
  setCloud({ pending: null, dashboardNonce: cloud().dashboardNonce + 1 });
  if (scene) await reattach(scene.id, token);
  if (!pending) return;
  if (pending.kind === "open") {
    getState().setAppState({ openDialog: null });
    await openCloudScene(pending.id, pending.token, { confirm: false });
  } else if (pending.kind === "invite") {
    openModal({ kind: "invite", token: pending.token });
  } else if (pending.kind === "saveAs") {
    getState().setAppState({ openDialog: null });
    openModal({ kind: "saveAs" });
  }
}

export async function signOut() {
  try {
    await flushSave();
    await Api.signOut();
  } catch (e) {
    toastError(e);
    return;
  }
  const { scene, token } = cloud();
  if (scene && !(scene.viaLink && token)) detach();
  setCloud({ user: null, unreadNotifications: 0, threads: [], commentMode: false, draft: null, activeThreadId: null });
  if (scene && scene.viaLink && token) await reattach(scene.id, token);
  showToast("Signed out of Excalimade+");
}

// ---- URL ---------------------------------------------------------------------------------------

export const sceneLink = (id: string, token?: string | null) =>
  `${location.origin}${location.pathname}#cloud=${id}${token ? `&t=${encodeURIComponent(token)}` : ""}`;
export const embedLink = (id: string, token: string) =>
  `${location.origin}${location.pathname}?embed=1#cloud=${id}&t=${encodeURIComponent(token)}`;

function setHash(id: string, token: string | null, push: boolean) {
  const hash = `#cloud=${id}${token ? `&t=${encodeURIComponent(token)}` : ""}`;
  if (location.hash === hash) return;
  const url = `${location.pathname}${location.search}${hash}`;
  if (push) history.pushState(history.state, "", url);
  else history.replaceState(history.state, "", url);
}

function clearHash() {
  if (/^#(cloud|invite)=/.test(location.hash)) history.replaceState(history.state, "", `${location.pathname}${location.search}`);
}

/** React to `#cloud=<id>&t=<token>` and `#invite=<token>` (startup + hashchange). */
export async function handleHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  const invite = params.get("invite");
  if (invite) {
    clearHash();
    if (cloud().user) openModal({ kind: "invite", token: invite });
    else {
      setCloud({ pending: { kind: "invite", token: invite } });
      getState().setAppState({ openDialog: "cloud" });
      showToast("Sign in or create an account to join the workspace");
    }
    return;
  }
  const id = params.get("cloud");
  if (id && id !== cloud().scene?.id) await openCloudScene(id, params.get("t"), { confirm: false, fromUrl: true });
  else if (!id && cloud().scene && !location.hash) detach();
}

// ---- open / attach / detach --------------------------------------------------------------------

/** Open a cloud scene onto the canvas (respecting permissions). */
export async function openCloudScene(id: string, token: string | null, opts: { confirm?: boolean; fromUrl?: boolean; threadId?: string } = {}) {
  if (opening === id) return;
  if (cloud().scene?.id === id && !cloud().preview) {
    if (opts.threadId) focusThread(opts.threadId);
    return;
  }
  if (opts.confirm !== false && !cloud().scene && getNonDeletedElements().length > 0) {
    const choice = await confirmDialog({
      title: "Replace the current canvas?",
      message: "Your current drawing isn't saved to Excalimade+. Opening a cloud scene replaces it on the canvas.",
      confirmLabel: "Replace",
      extraLabel: "Save it to Excalimade+ first",
      danger: true,
    });
    if (!choice) return;
    if (choice === "extra" && !(await saveAsNew({ attach: false }))) return;
  }
  opening = id;
  try {
    const { scene: meta } = await Api.scene(id, token);
    if (meta.deletedAt) {
      showToast("This scene is in the trash — restore it from the dashboard first", "error");
      return;
    }
    const data = await Api.sceneData(id, token);
    const restored = parseCloudScene(data);
    await flushSave();
    detach({ keepUrl: true });
    applyCloudScene(restored);
    attach(meta, token, { push: !opts.fromUrl });
    if (opts.threadId) setTimeout(() => focusThread(opts.threadId!), 300);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      setCloud({ pending: { kind: "open", id, token } });
      getState().setAppState({ openDialog: "cloud" });
      showToast("Sign in to open this scene");
    } else {
      toastError(e);
      if (opts.fromUrl) clearHash();
    }
  } finally {
    opening = null;
  }
}

/** Bind the session to a scene whose content is already on the canvas. */
function attach(meta: SceneMeta, token: string | null, opts: { push: boolean }) {
  const { embed } = cloud();
  const editable = meta.permission === "edit" && !embed;
  setCloud({
    scene: meta,
    token,
    status: editable ? "saved" : "view",
    lastSavedAt: meta.updatedAt,
    threads: [],
    activeThreadId: null,
    draft: null,
    preview: null,
    commentMode: false,
  });
  lastSig = contentSignature(serializeCloudScene());
  lastThumbAt = Date.now();
  getState().setAppState({
    name: meta.name,
    viewModeEnabled: !editable,
    ...(embed ? { zenModeEnabled: true, openSidebar: null, openDialog: null } : {}),
  });
  setHash(meta.id, token, opts.push);
  watchChanges();
  joinRoom();
  void refreshThreads();
}

/** Re-fetch permissions for the open scene (after sign-in/out) without reloading the canvas. */
async function reattach(id: string, token: string | null) {
  try {
    const { scene: meta } = await Api.scene(id, token);
    const was = cloud().scene;
    setCloud({ scene: meta, status: meta.permission === "edit" && !cloud().embed ? "saved" : "view" });
    getState().setAppState({ viewModeEnabled: meta.permission !== "edit" || cloud().embed });
    if (was?.permission !== "edit" && meta.permission === "edit") joinRoom();
    void refreshThreads();
  } catch {
    detach();
  }
}

/** Leave the current cloud scene (the canvas content stays as a local copy). */
export function detach(opts: { keepUrl?: boolean } = {}) {
  const { scene } = cloud();
  if (!scene) return;
  clearTimeout(saveTimer);
  clearInterval(retryTimer);
  retryTimer = undefined;
  unsubStore?.();
  unsubStore = null;
  if (collabOwned && isCollaborating()) stopCollab();
  collabOwned = false;
  collabPausedForPreview = false;
  stash = null;
  paused = false;
  lastSig = null;
  const as = getState().appState;
  getState().setAppState({
    viewModeEnabled: false,
    openSidebar: as.openSidebar === "comments" || as.openSidebar === "versions" ? null : as.openSidebar,
  });
  setCloud({ scene: null, token: null, status: "idle", threads: [], commentMode: false, draft: null, activeThreadId: null, preview: null });
  if (!opts.keepUrl) clearHash();
}

function joinRoom() {
  const { scene, embed, user } = cloud();
  if (!scene?.room || embed || !user) return;
  // an ad-hoc live session the user started themselves wins — don't hijack it
  if (isCollaborating() && !collabOwned) return;
  if (collabOwned && isCollaborating()) stopCollab();
  startCollab({ roomId: scene.room.roomId, roomKey: scene.room.roomKey, persistent: true, updateUrl: false })
    .then(() => {
      if (cloud().scene?.id === scene.id) collabOwned = true;
      else stopCollab();
    })
    .catch((e) => console.warn("[cloud] couldn't join the scene's live room", e));
}

// another scene loaded from a file / link replaces the cloud scene on the canvas
on("sceneLoaded", ({ source }) => {
  if ((source === "file" || source === "link") && cloud().scene && !stash) detach();
});

// ---- autosave ----------------------------------------------------------------------------------

function watchChanges() {
  unsubStore?.();
  unsubStore = useStore.subscribe((s, prev) => {
    if (paused) return;
    const a = s.appState;
    const b = prev.appState;
    if (
      s.elements !== prev.elements ||
      s.files !== prev.files ||
      a.name !== b.name ||
      a.viewBackgroundColor !== b.viewBackgroundColor ||
      a.gridModeEnabled !== b.gridModeEnabled ||
      a.gridSize !== b.gridSize
    )
      scheduleSave();
  });
}

const canSave = () => {
  const { scene, user, embed } = cloud();
  return !!scene && !!user && scene.permission === "edit" && !embed && !paused;
};

function scheduleSave() {
  if (!canSave()) return;
  clearTimeout(saveTimer);
  if (cloud().status !== "saving" && cloud().status !== "offline") setCloud({ status: "unsaved" });
  saveTimer = setTimeout(() => void flushSave(), AUTOSAVE_DELAY);
}

/** Save now if anything changed. `explicit` always saves and creates a version snapshot. */
export async function flushSave(opts: { explicit?: boolean; versionName?: string | null; restoredFrom?: number | null } = {}): Promise<void> {
  clearTimeout(saveTimer);
  if (inFlight) {
    if (!opts.explicit) {
      again = true;
      return inFlight;
    }
    await inFlight;
  }
  if (!canSave()) return;
  const { scene, token } = cloud();
  if (!scene) return;
  const doc = serializeCloudScene();
  const sig = contentSignature(doc);
  const name = getState().appState.name.trim();
  const nameChanged = !!name && name !== scene.name;
  if (!opts.explicit && sig === lastSig && !nameChanged) {
    if (cloud().status !== "saved") setCloud({ status: "saved" });
    return;
  }
  setCloud({ status: "saving" });
  inFlight = (async () => {
    try {
      if (opts.explicit || sig !== lastSig) {
        const wantThumb = opts.explicit || Date.now() - lastThumbAt > THUMB_INTERVAL || !scene.hasThumb;
        const thumb = wantThumb ? await makeThumbnail() : undefined;
        if (thumb !== undefined) lastThumbAt = Date.now();
        const r = await Api.saveScene(scene.id, token, {
          scene: doc,
          ...(thumb !== undefined ? { thumb } : {}),
          explicit: !!opts.explicit,
          versionName: opts.versionName ?? null,
          restoredFrom: opts.restoredFrom ?? null,
        });
        lastSig = sig;
        setCloud((s) => ({
          scene: s.scene && s.scene.id === scene.id
            ? { ...s.scene, revision: r.revision, updatedAt: r.updatedAt, hasThumb: thumb !== undefined ? !!thumb : s.scene.hasThumb }
            : s.scene,
          lastSavedAt: r.updatedAt,
          dashboardNonce: s.dashboardNonce + 1,
        }));
      }
      if (nameChanged) {
        const r = await Api.updateScene(scene.id, token, { name });
        setCloud((s) => ({ scene: s.scene && s.scene.id === scene.id ? { ...s.scene, name: r.scene.name } : s.scene }));
      }
      clearInterval(retryTimer);
      retryTimer = undefined;
      if (cloud().scene?.id === scene.id) setCloud({ status: "saved" });
    } catch (e) {
      if (cloud().scene?.id !== scene.id) return;
      if (e instanceof ApiError && e.status === 0) {
        setCloud({ status: "offline" });
        if (!retryTimer) retryTimer = setInterval(() => void flushSave(), 15_000);
      } else {
        setCloud({ status: "error" });
        showToast(`Couldn't save "${scene.name}": ${errorMessage(e)}`, "error");
        if (e instanceof ApiError && (e.status === 403 || e.status === 404 || e.status === 401)) void reattach(scene.id, token);
      }
      if (opts.explicit) throw e;
    } finally {
      inFlight = null;
      if (again) {
        again = false;
        scheduleSave();
      }
    }
  })();
  return inFlight;
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    if (cloud().status === "offline") void flushSave();
  });
  window.addEventListener("offline", () => {
    if (cloud().scene && cloud().status !== "view") setCloud({ status: "offline" });
  });
  window.addEventListener("beforeunload", (e) => {
    const st = cloud().status;
    if (st === "unsaved" || st === "saving" || st === "offline") {
      void flushSave();
      e.preventDefault();
    }
  });
}

// ---- save as -----------------------------------------------------------------------------------

/** "Export to Excalimade+": store the current canvas as a new cloud scene. Returns the new scene. */
export async function saveAsNew(
  opts: { name?: string; workspaceId?: string; collectionId?: string | null; attach?: boolean } = {},
): Promise<SceneMeta | null> {
  if (!cloud().user) {
    setCloud({ pending: { kind: "saveAs" } });
    getState().setAppState({ openDialog: "cloud" });
    return null;
  }
  try {
    let workspaceId = opts.workspaceId;
    if (!workspaceId) {
      const { workspaces } = await Api.workspaces();
      workspaceId = (workspaces.find((w) => w.personal) ?? workspaces[0])?.id;
    }
    if (!workspaceId) throw new Error("No workspace available");
    const name = (opts.name ?? getState().appState.name).trim() || "Untitled scene";
    const doc = serializeCloudScene();
    const thumb = await makeThumbnail();
    const { scene } = await Api.createScene({ workspaceId, collectionId: opts.collectionId ?? null, name, scene: doc, thumb: thumb ?? null });
    setCloud((s) => ({ dashboardNonce: s.dashboardNonce + 1 }));
    if (opts.attach !== false) {
      await flushSave();
      detach({ keepUrl: true });
      attach({ ...scene, hasThumb: !!thumb }, null, { push: true });
      showToast(`Saved to Excalimade+ as "${scene.name}"`, "success");
    } else showToast(`Saved "${scene.name}" to Excalimade+`, "success");
    return scene;
  } catch (e) {
    toastError(e);
    return null;
  }
}

/** Replace the canvas with a new, empty cloud scene in the given workspace/collection. */
export async function createBlankScene(workspaceId: string, collectionId: string | null, name = "Untitled scene") {
  const doc = { type: "excalidraw", version: 2, source: location.origin, elements: [], appState: { viewBackgroundColor: getState().appState.viewBackgroundColor }, files: {} };
  const { scene } = await Api.createScene({ workspaceId, collectionId, name, scene: doc, thumb: null });
  setCloud((s) => ({ dashboardNonce: s.dashboardNonce + 1 }));
  await openCloudScene(scene.id, null);
  return scene;
}

export function updateCurrentMeta(meta: SceneMeta) {
  if (cloud().scene?.id !== meta.id) return;
  setCloud({ scene: meta });
  if (getState().appState.name !== meta.name) {
    paused = true;
    getState().setAppState({ name: meta.name });
    paused = false;
  }
}

// ---- versions ----------------------------------------------------------------------------------

export async function previewVersion(v: VersionInfo) {
  const { scene, token } = cloud();
  if (!scene) return;
  try {
    const data = parseCloudScene(await Api.versionData(scene.id, v.id, token));
    if (!stash) {
      await flushSave();
      const st = getState();
      stash = {
        elements: st.elements,
        files: st.files,
        appState: { scrollX: st.appState.scrollX, scrollY: st.appState.scrollY, zoom: st.appState.zoom, name: st.appState.name },
      };
      paused = true;
      if (collabOwned && isCollaborating()) {
        stopCollab();
        collabOwned = false;
        collabPausedForPreview = true;
      }
    }
    applyCloudScene(data);
    getState().setAppState({ viewModeEnabled: true, name: stash.appState.name ?? scene.name });
    setCloud({ preview: v, commentMode: false, draft: null, activeThreadId: null });
  } catch (e) {
    toastError(e);
  }
}

export function exitPreview() {
  if (!stash) return;
  const { scene, embed } = cloud();
  const s = stash;
  stash = null;
  useStore.setState((st) => ({ elements: s.elements, files: s.files, sceneNonce: st.sceneNonce + 1 }));
  getState().clearHistory();
  getState().setAppState({ ...s.appState, viewModeEnabled: scene?.permission !== "edit" || embed, selectedElementIds: {} });
  paused = false;
  setCloud({ preview: null });
  if (collabPausedForPreview) {
    collabPausedForPreview = false;
    joinRoom();
  }
}

export async function restoreVersion(v: VersionInfo) {
  const { scene, token } = cloud();
  if (!scene || scene.permission !== "edit") return;
  try {
    const data = parseCloudScene(await Api.versionData(scene.id, v.id, token));
    const base = stash?.elements ?? getState().elements;
    const baseFiles = stash?.files ?? getState().files;
    const appStateBack = stash?.appState;
    const merged = bumpForRestore(data.elements, base);
    stash = null;
    const st = getState();
    if (!cloud().preview) st.recordHistory();
    useStore.setState((x) => ({ elements: merged, files: { ...baseFiles, ...data.files }, sceneNonce: x.sceneNonce + 1 }));
    const { theme: _t, username: _u, scrollX: _sx, scrollY: _sy, zoom: _z, ...docState } = data.appState;
    st.setAppState({ ...docState, ...(appStateBack ?? {}), viewModeEnabled: false, selectedElementIds: {} });
    paused = false;
    setCloud({ preview: null });
    await flushSave({ explicit: true, restoredFrom: v.createdAt });
    if (collabPausedForPreview) {
      collabPausedForPreview = false;
      joinRoom();
    }
    showToast(`Restored the version from ${new Date(v.createdAt).toLocaleString()}`, "success");
  } catch (e) {
    toastError(e);
  }
}

// ---- comments & notifications ----------------------------------------------------------------

export async function refreshThreads() {
  const { scene, user, token } = cloud();
  if (!scene || !user || !scene.canComment) return;
  try {
    const { threads } = await Api.threads(scene.id, token);
    if (cloud().scene?.id === scene.id) setCloud({ threads });
  } catch {
    /* transient — next poll retries */
  }
}

export async function refreshNotifications() {
  if (!cloud().user) return;
  try {
    const { unread } = await Api.notifications();
    setCloud({ unreadNotifications: unread });
  } catch {
    /* ignore */
  }
}

/** Absolute scene position of a thread pin (follows its anchor element when it still exists). */
export function threadPosition(t: { x: number; y: number; elementId: string | null; ox: number; oy: number }, elements = getState().elements): [number, number] {
  if (t.elementId) {
    const el = elements.find((e) => e.id === t.elementId);
    if (el && !el.isDeleted) return [el.x + t.ox, el.y + t.oy];
  }
  return [t.x, t.y];
}

export function focusThread(threadId: string) {
  const t = cloud().threads.find((x) => x.id === threadId);
  if (!t) {
    // not loaded yet — load and retry once
    void refreshThreads().then(() => {
      if (cloud().threads.some((x) => x.id === threadId)) focusThread(threadId);
    });
    return;
  }
  const [x, y] = threadPosition(t);
  const { appState } = getState();
  // keep room for the thread popover to the right of the pin
  void import("../core/viewport").then(({ animateViewport }) =>
    animateViewport({
      zoom: appState.zoom,
      scrollX: appState.width / 2 / appState.zoom - x - Math.min(160, appState.width / 6) / appState.zoom,
      scrollY: appState.height / 2 / appState.zoom - y,
    }),
  );
  setCloud({ activeThreadId: threadId, commentFilter: t.resolvedAt ? "resolved" : "open", draft: null });
}

export function toggleCommentMode(force?: boolean) {
  const { scene, user, commentMode, preview } = cloud();
  if (!scene) {
    showToast("Save the scene to Excalimade+ to add comments");
    return;
  }
  if (!user) {
    showToast("Sign in to comment");
    getState().setAppState({ openDialog: "cloud" });
    return;
  }
  if (preview) {
    showToast("Go back to the latest version to comment");
    return;
  }
  const next = force ?? !commentMode;
  setCloud({ commentMode: next, draft: null });
  if (next) {
    getState().setAppState({ activeTool: "selection", selectedElementIds: {} });
    showToast("Comment mode — click anywhere on the canvas to leave a comment. Esc to exit.");
  }
}
