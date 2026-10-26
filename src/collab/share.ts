// Encrypted read-only share links: #json=<id>,<key>
import { getNonDeletedElements, getState, PERSISTED_APPSTATE_KEYS, showToast } from "../core/store";
import { emit } from "../core/events";
import type { AppState, BinaryFile, BinaryFiles, ImageElement, Scene } from "../core/types";
import { gunzip, gzip } from "../core/utils";
import { zoomToFit } from "../core/viewport";
import { decryptBytes, encryptBytes, generateKey, importKey, ROOM_KEY_RE, SHARE_ID_RE } from "./crypto";
import { isValidElement } from "./reconcile";
import { getCollab, setCollab } from "./state";

/** Viewer-specific keys that a shared scene must not impose on the viewer. */
const SKIP_KEYS = new Set<string>(["theme", "username", "scrollX", "scrollY", "zoom"]);

function serializeCurrentScene(): Scene {
  const { elements, files, appState } = getState();
  const live = getNonDeletedElements(elements);
  const usedFiles: BinaryFiles = {};
  for (const el of live) {
    if (el.type !== "image") continue;
    const f = files[(el as ImageElement).fileId];
    if (f) usedFiles[f.id] = f;
  }
  const persisted: Partial<AppState> = {};
  for (const k of PERSISTED_APPSTATE_KEYS) (persisted as Record<string, unknown>)[k] = appState[k];
  delete persisted.username;
  return { type: "excalidraw", version: 2, source: location.origin, elements: live, appState: persisted, files: usedFiles };
}

export const shareLinkFor = (id: string, key: string) => `${location.origin}/#json=${id},${key}`;
export const embedSnippetFor = (id: string, key: string) =>
  `<iframe src="${location.origin}/?embed=1#json=${id},${key}" width="800" height="600" style="border:0;border-radius:8px" allowfullscreen></iframe>`;

/** Encrypts the current scene, uploads it and returns the read-only link + embed snippet. */
export async function createShareLink(): Promise<{ link: string; embed: string } | null> {
  if (!getNonDeletedElements().length) {
    showToast("Draw something first — the canvas is empty.", "error");
    return null;
  }
  setCollab({ shareBusy: true });
  try {
    const keyStr = await generateKey();
    const key = await importKey(keyStr);
    const bytes = await encryptBytes(key, await gzip(JSON.stringify(serializeCurrentScene())));
    // Vercel functions cap uploads at 4.5 MB (server enforces it too)
    const maxMb = Number(import.meta.env.VITE_SHARE_MAX_MB) || 4;
    if (bytes.length > maxMb * 1024 * 1024) {
      showToast(`This scene is too large to share as a link (${maxMb} MB max after compression). Try removing or shrinking some images.`, "error");
      return null;
    }
    const res = await fetch("/api/share", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: bytes as Uint8Array<ArrayBuffer>,
    });
    if (!res.ok) {
      const msg = await res.json().catch(() => null);
      throw new Error(msg?.error ?? `Upload failed (${res.status})`);
    }
    const { id } = (await res.json()) as { id: string };
    if (!SHARE_ID_RE.test(id)) throw new Error("Unexpected server response");
    const out = { link: shareLinkFor(id, keyStr), embed: embedSnippetFor(id, keyStr) };
    setCollab({ shareLink: out });
    return out;
  } catch (err: any) {
    showToast(navigator.onLine ? `Couldn't create the link: ${err?.message ?? err}` : "You're offline — can't create a link.", "error");
    return null;
  } finally {
    setCollab({ shareBusy: false });
  }
}

/** Opens a #json link in read-only (view) mode. */
export async function loadSharedScene(id: string, keyStr: string, embed: boolean) {
  if (!SHARE_ID_RE.test(id) || !ROOM_KEY_RE.test(keyStr)) {
    showToast("This share link is invalid.", "error");
    return false;
  }
  try {
    const res = await fetch(`/api/share/${id}`);
    if (res.status === 404) {
      showToast("This shared drawing no longer exists.", "error");
      return false;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const key = await importKey(keyStr);
    const plain = await decryptBytes(key, new Uint8Array(await res.arrayBuffer()));
    const scene = JSON.parse(await gunzip(plain)) as Partial<Scene>;
    const elements = (Array.isArray(scene.elements) ? scene.elements : []).filter(isValidElement);
    const files = Object.values((scene.files ?? {}) as Record<string, BinaryFile>).filter(
      (f) => f && typeof f.id === "string" && typeof f.dataURL === "string" && f.dataURL.startsWith("data:"),
    );
    const patch: Record<string, unknown> = {};
    if (scene.appState && typeof scene.appState === "object") {
      for (const k of PERSISTED_APPSTATE_KEYS) {
        if (SKIP_KEYS.has(k) || !(k in scene.appState)) continue;
        patch[k] = (scene.appState as Record<string, unknown>)[k];
      }
    }
    const st = getState();
    st.setElements(elements);
    if (files.length) st.addFiles(files);
    st.clearHistory();
    st.setAppState({
      ...(patch as Partial<AppState>),
      selectedElementIds: {},
      editingTextId: null,
      viewModeEnabled: true,
      zenModeEnabled: embed,
      activeTool: "hand",
      openDialog: null,
    });
    setCollab({ sharedView: { embed } });
    emit("sceneLoaded", { source: "link" });
    requestAnimationFrame(() => zoomToFit(undefined, { maxZoom: 1 }));
    return true;
  } catch (err) {
    console.warn("[collab] share link failed", err);
    showToast("Couldn't open the shared drawing — the link may be damaged.", "error");
    return false;
  }
}

/** "Make a copy to edit": leave view mode and hand the scene to local autosave. */
export function makeEditableCopy() {
  if (!getCollab().sharedView) return;
  setCollab({ sharedView: null });
  getState().setAppState({ viewModeEnabled: false, zenModeEnabled: false, activeTool: "selection" });
  history.replaceState(history.state, "", location.pathname);
  emit("sceneLoaded", { source: "local" });
  const title = getState().appState.name && getState().appState.name !== "Untitled drawing" ? `${getState().appState.name} (copy)` : "Shared drawing";
  void import("../workspace/store").then((m) => m.saveCanvasAsNewScene(title));
  showToast("Saved a copy to your workspace", "success");
}
