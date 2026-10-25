// Scene (de)serialisation for cloud storage + small WebP thumbnails.
import { getState, getNonDeletedElements } from "../core/store";
import type { ExcalidrawElement, Scene } from "../core/types";
import { randomInteger, bytesToBase64 } from "../core/utils";
import { exportToCanvas } from "../render/export";
import { serializeSceneObject, parseScene, applyScene, type RestoredScene } from "../io/serialize";

/** The current canvas as a cloud scene document (no session-only state, only referenced files). */
export function serializeCloudScene(): Scene {
  const scene = serializeSceneObject();
  // theme and username are personal preferences, not part of a shared document
  const appState = { ...scene.appState };
  delete appState.theme;
  delete appState.username;
  return { ...scene, appState };
}

/** Content signature used to skip no-op saves (ignores viewport scroll/zoom). */
export function contentSignature(scene: Scene) {
  const { scrollX: _x, scrollY: _y, zoom: _z, ...rest } = scene.appState;
  return JSON.stringify([scene.elements, rest, Object.keys(scene.files).sort()]);
}

export function parseCloudScene(json: unknown): RestoredScene {
  return parseScene(json);
}

export function applyCloudScene(scene: RestoredScene, opts: { fit?: boolean } = {}) {
  applyScene(scene, "cloud", { fit: opts.fit ?? true });
}

/**
 * Restoring an older version while others may hold newer copies of the same elements:
 * give every element that differs a version above the current one and soft-delete elements
 * that didn't exist in the old version, so collaborators and the room snapshot accept it.
 */
export function bumpForRestore(target: ExcalidrawElement[], current: ExcalidrawElement[]) {
  const cur = new Map(current.map((e) => [e.id, e]));
  const ids = new Set(target.map((e) => e.id));
  const t = Date.now();
  const out = target.map((el) => {
    const c = cur.get(el.id);
    return { ...el, version: Math.max(el.version, (c?.version ?? 0)) + 1, versionNonce: randomInteger(), updated: t };
  });
  for (const c of current) {
    if (!ids.has(c.id) && !c.isDeleted) out.push({ ...c, isDeleted: true, version: c.version + 1, versionNonce: randomInteger(), updated: t });
  }
  return out;
}

const THUMB_MAX_W = 320;
const THUMB_MAX_H = 240;

const canvasToBlob = (c: HTMLCanvasElement, type: string, q: number) =>
  new Promise<Blob | null>((resolve) => c.toBlob(resolve, type, q));

/**
 * ≤320px-wide WebP thumbnail (PNG fallback where WebP encoding is unsupported) as base64.
 * null = the scene is empty (clear the thumbnail); undefined = couldn't render (keep the old one).
 */
export async function makeThumbnail(): Promise<string | null | undefined> {
  const { files, appState } = getState();
  const elements = getNonDeletedElements();
  if (!elements.length) return null;
  try {
    const full = await exportToCanvas(elements, {
      files,
      exportBackground: true,
      viewBackgroundColor: appState.viewBackgroundColor,
      exportDarkMode: false,
      scale: 1,
      padding: 24,
    });
    const k = Math.min(1, THUMB_MAX_W / full.width, THUMB_MAX_H / full.height);
    const w = Math.max(1, Math.round(full.width * k));
    const h = Math.max(1, Math.round(full.height * k));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(full, 0, 0, w, h);
    let blob = await canvasToBlob(c, "image/webp", 0.7);
    if (!blob || blob.size > 250 * 1024) blob = await canvasToBlob(c, "image/png", 1);
    if (!blob || blob.size > 250 * 1024) return undefined;
    return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
  } catch {
    return undefined; // exporting isn't available (or failed) — keep the previous thumbnail
  }
}
