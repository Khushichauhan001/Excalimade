// Decoded image cache shared by the canvas renderer and exporters.
import type { BinaryFiles } from "../core/types";

const cache = new Map<string, { dataURL: string; img: HTMLImageElement; ready: boolean }>();
const listeners = new Set<() => void>();

export const onImageLoaded = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

/** Returns the decoded image, or undefined while it is still loading (repaint listeners fire when ready). */
export function getImage(fileId: string, files: BinaryFiles): HTMLImageElement | undefined {
  const file = files[fileId];
  if (!file) return undefined;
  let entry = cache.get(fileId);
  if (!entry || entry.dataURL !== file.dataURL) {
    const img = new Image();
    entry = { dataURL: file.dataURL, img, ready: false };
    const e = entry;
    img.onload = () => {
      e.ready = true;
      listeners.forEach((l) => l());
    };
    img.src = file.dataURL;
    cache.set(fileId, entry);
  }
  return entry.ready ? entry.img : undefined;
}

/** Wait until all given images are decoded (used by exporters). */
export async function preloadImages(fileIds: string[], files: BinaryFiles) {
  await Promise.all(
    fileIds.map(async (id) => {
      if (!files[id]) return;
      getImage(id, files);
      const img = cache.get(id)!.img;
      if (!img.complete || !img.naturalWidth) await img.decode().catch(() => undefined);
      cache.get(id)!.ready = true;
    }),
  );
}
