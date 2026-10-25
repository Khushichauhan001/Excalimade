// Open / save scenes and route any incoming file (picker, drop) to the right place.
import { getState, getNonDeletedElements, showToast } from "../core/store";
import { on } from "../core/events";
import { insertImageFiles } from "../canvas/api";
import { loadScene, serializeScene, InvalidSceneError } from "./serialize";
import { openFiles, saveBlob, fileExtension, stripExtension, type FileHandle } from "./fileio";
import { extractSceneFromPng, isPng } from "./png";
import { extractSceneFromSvg } from "./svgEmbed";
import { EXCALIDRAW_MIME, EXCALIDRAW_LIB_MIME } from "./encode";
import { choose, confirmDialog } from "./Dialog";

let sceneHandle: FileHandle | null = null;
export const getSceneFileHandle = () => sceneHandle;

// a scene coming from anywhere but a file on disk detaches the "current file"
on("sceneLoaded", ({ source }) => {
  if (source !== "file") sceneHandle = null;
});

const SCENE_EXTS = [".excalidraw", ".json"];
const LIB_EXTS = [".excalidrawlib"];

export const isCanvasEmpty = () => getNonDeletedElements().length === 0;

async function confirmReplace() {
  if (isCanvasEmpty()) return true;
  return confirmDialog({
    title: "Replace your drawing?",
    message: "Opening this file will replace the current canvas content. Save your drawing first if you want to keep it.",
    confirmLabel: "Replace",
    danger: true,
  });
}

async function importLibraryText(text: string) {
  const { parseLibrary } = await import("../library/format");
  const { addLibraryItems } = await import("../library/store");
  const items = parseLibrary(text);
  const n = await addLibraryItems(items);
  getState().setAppState({ openSidebar: "library" });
  showToast(n ? `Added ${n} item${n === 1 ? "" : "s"} to your library` : "These items are already in your library", n ? "success" : "info");
}

const isImage = (f: File) => f.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(f.name);

/** What a file contains: an embedded/plain scene, a library, a plain image, or nothing we know. */
export async function sniffFile(
  file: File,
): Promise<{ kind: "scene"; json: string } | { kind: "library"; json: string } | { kind: "image" } | { kind: "unknown" }> {
  const ext = fileExtension(file.name);
  if (file.type === "image/png" || ext === ".png") {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (isPng(bytes)) {
      try {
        const json = await extractSceneFromPng(bytes);
        if (json) return { kind: "scene", json };
      } catch (e) {
        console.warn("Embedded scene could not be decoded", e);
      }
    }
    return { kind: "image" };
  }
  if (file.type === "image/svg+xml" || ext === ".svg") {
    try {
      const json = await extractSceneFromSvg(await file.text());
      if (json) return { kind: "scene", json };
    } catch (e) {
      console.warn("Embedded scene could not be decoded", e);
    }
    return { kind: "image" };
  }
  if (isImage(file)) return { kind: "image" };
  if (LIB_EXTS.includes(ext) || file.type === EXCALIDRAW_LIB_MIME) return { kind: "library", json: await file.text() };
  if (SCENE_EXTS.includes(ext) || file.type === EXCALIDRAW_MIME || file.type === "application/json" || file.type === "" || file.type.startsWith("text/")) {
    if (file.size > 200 * 1024 * 1024) return { kind: "unknown" };
    const json = await file.text();
    const head = json.slice(0, 400);
    if (/"type"\s*:\s*"excalidrawlib"/.test(head) || /"type"\s*:\s*"excalidrawlib"/.test(json.slice(0, 4000))) return { kind: "library", json };
    if (/"type"\s*:\s*"excalidraw"/.test(json.slice(0, 4000)) || /"elements"\s*:/.test(json)) return { kind: "scene", json };
  }
  return { kind: "unknown" };
}

function loadSceneSafe(json: string, name: string, handle: FileHandle | null) {
  try {
    const scene = loadScene(json, "file");
    sceneHandle = handle;
    if (!scene.appState.name) getState().setAppState({ name: stripExtension(name) });
    return true;
  } catch (e) {
    showToast(e instanceof InvalidSceneError ? e.message : "Couldn't open this file.", "error");
    return false;
  }
}

/**
 * Handle files from the open picker or a drop.
 * - scene files load (after confirming replacement) · libraries are imported
 * - images insert at `clientPoint` (drop) · PNG/SVG with an embedded scene offer to open it
 */
export async function handleIncomingFiles(
  entries: { file: File; handle?: FileHandle | null }[],
  origin: "open" | "drop",
  clientPoint?: { x: number; y: number },
) {
  const images: File[] = [];
  let sceneDone = false;
  for (const { file, handle } of entries) {
    const what = await sniffFile(file);
    if (what.kind === "library") {
      try {
        await importLibraryText(what.json);
      } catch (e) {
        showToast(e instanceof Error ? e.message : "Invalid library file", "error");
      }
    } else if (what.kind === "scene" && !sceneDone) {
      const isImg = isImage(file);
      if (isImg && origin === "drop") {
        const pick = await choose(
          "This image contains a drawing",
          "The image was exported with its scene data. Open it as an editable drawing, or insert it as a picture?",
          [
            { id: "image", label: "Insert as image" },
            { id: "scene", label: "Open as drawing", kind: "primary" },
          ],
        );
        if (pick === "image") images.push(file);
        if (pick !== "scene") continue;
        if (!isCanvasEmpty() && !(await confirmReplace())) continue;
      } else if (!(await confirmReplace())) continue;
      sceneDone = loadSceneSafe(what.json, file.name, isImg ? null : handle ?? null);
    } else if (what.kind === "image") {
      images.push(file);
    } else if (what.kind === "scene") {
      showToast("Only one drawing can be opened at a time.", "info");
    } else {
      showToast(`Unsupported file: ${file.name}`, "error");
    }
  }
  if (images.length) {
    if (getState().appState.viewModeEnabled) return showToast("Images can't be added in view mode.", "info");
    await insertImageFiles(images, clientPoint);
  }
}

export async function openSceneFromDisk() {
  const files = await openFiles({
    description: "Excalidraw files",
    extensions: [".excalidraw", ".json", ".excalidrawlib", ".png", ".svg"],
    mimeTypes: [EXCALIDRAW_MIME, EXCALIDRAW_LIB_MIME, "application/json", "image/png", "image/svg+xml"],
  });
  if (files.length) await handleIncomingFiles(files, "open");
}

async function writeScene(handle: FileHandle | null | undefined) {
  const { appState } = getState();
  const blob = new Blob([serializeScene()], { type: EXCALIDRAW_MIME });
  const res = await saveBlob(blob, {
    name: appState.name,
    extension: ".excalidraw",
    mimeType: EXCALIDRAW_MIME,
    description: "Excalidraw file",
    handle,
  });
  if (res === "cancelled") return;
  if (res) {
    sceneHandle = res;
    const name = stripExtension(res.name);
    if (name && name !== appState.name) getState().setAppState({ name });
    showToast(`Saved to ${res.name}`, "success");
  } else {
    showToast("Drawing downloaded", "success");
  }
}

export async function saveScene() {
  try {
    await writeScene(sceneHandle);
  } catch (e) {
    console.error(e);
    sceneHandle = null;
    showToast("Couldn't save to the file — choose where to save it.", "error");
    await saveSceneAs();
  }
}

export async function saveSceneAs() {
  try {
    await writeScene(null);
  } catch (e) {
    console.error(e);
    showToast("Couldn't save the file.", "error");
  }
}
