// Image insertion: downscale + re-encode (WebP) to keep scenes small, dedupe by content hash.
import type { BinaryFile, ExcalidrawElement, ImageElement } from "../core/types";
import { getState, showToast } from "../core/store";
import { newImage } from "../core/elements";
import { viewportToScene } from "../core/utils";

const MAX_IMAGE_DIMENSION = 1920;
const MAX_DISPLAY_SIZE = 560;
const SUPPORTED = /^image\/(png|jpe?g|gif|webp|svg\+xml|bmp|avif)$/;

const readAsDataURL = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });

async function sha1Hex(text: string) {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode image"));
    img.src = src;
  });

let webpSupported: boolean | null = null;
const canEncodeWebp = () => {
  if (webpSupported === null) {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    webpSupported = c.toDataURL("image/webp").startsWith("data:image/webp");
  }
  return webpSupported;
};

/** Returns a compact dataURL plus natural size. Animated GIFs and SVGs are kept as-is. */
export async function prepareImage(file: Blob): Promise<{ dataURL: string; mimeType: string; width: number; height: number }> {
  const original = await readAsDataURL(file);
  const img = await loadImage(original);
  let width = img.naturalWidth || 300;
  let height = img.naturalHeight || 150;
  if (file.type === "image/svg+xml" || file.type === "image/gif") {
    return { dataURL: original, mimeType: file.type, width, height };
  }
  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(width, height));
  width = Math.round(width * scale);
  height = Math.round(height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);
  const mimeType = canEncodeWebp() ? "image/webp" : file.type === "image/png" ? "image/png" : "image/jpeg";
  const encoded = canvas.toDataURL(mimeType, 0.86);
  // keep whichever is smaller (re-encoding small PNG icons can grow them)
  const useEncoded = encoded.length < original.length || scale < 1 || file.type === "image/bmp";
  return { dataURL: useEncoded ? encoded : original, mimeType: useEncoded ? mimeType : file.type, width, height };
}

/** Create image elements for files, centred on a client point (or the viewport centre). */
export async function insertImages(files: File[], clientPoint?: { x: number; y: number }) {
  const images = files.filter((f) => SUPPORTED.test(f.type));
  if (!images.length) {
    if (files.length) showToast("Unsupported file type", "error");
    return [];
  }
  const s = getState();
  const as = s.appState;
  const [cx, cy] = viewportToScene(clientPoint?.x ?? as.width / 2, clientPoint?.y ?? as.height / 2, as);
  const created: ExcalidrawElement[] = [];
  const newFiles: BinaryFile[] = [];
  let offset = 0;
  for (const file of images) {
    try {
      const prepared = await prepareImage(file);
      const id = await sha1Hex(prepared.dataURL);
      if (!s.files[id]) newFiles.push({ id, mimeType: prepared.mimeType, dataURL: prepared.dataURL, created: Date.now() });
      const k = Math.min(1, MAX_DISPLAY_SIZE / Math.max(prepared.width, prepared.height));
      const w = prepared.width * k, h = prepared.height * k;
      created.push(
        newImage({ fileId: id, x: cx - w / 2 + offset, y: cy - h / 2 + offset, width: w, height: h }) as ImageElement,
      );
      offset += 20;
    } catch {
      showToast(`Couldn't load ${file.name || "image"}`, "error");
    }
  }
  if (!created.length) return [];
  const st = getState();
  if (newFiles.length) st.addFiles(newFiles);
  st.recordHistory();
  st.setElements([...st.elements, ...created]);
  const sel: Record<string, true> = {};
  for (const e of created) sel[e.id] = true;
  st.setAppState({ selectedElementIds: sel, activeTool: st.appState.toolLocked ? st.appState.activeTool : "selection" });
  return created;
}
