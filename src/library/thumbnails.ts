// Library item previews rendered with exportToSvg, cached in memory as object URLs (sequential queue).
import type { LibraryItem } from "../core/types";
import { getState } from "../core/store";
import { exportToSvg } from "../render/export";

const cache = new Map<string, Promise<string | null>>();
let chain: Promise<unknown> = Promise.resolve();

const key = (item: LibraryItem, dark: boolean) => `${item.id}:${dark ? 1 : 0}`;

export function getThumbnail(item: LibraryItem, dark: boolean): Promise<string | null> {
  const k = key(item, dark);
  let p = cache.get(k);
  if (!p) {
    p = chain.then(async () => {
      try {
        const svg = await exportToSvg(item.elements, {
          files: getState().files,
          exportBackground: false,
          viewBackgroundColor: "transparent",
          exportDarkMode: dark,
          scale: 1,
          padding: 6,
        });
        const text = new XMLSerializer().serializeToString(svg);
        return URL.createObjectURL(new Blob([text], { type: "image/svg+xml" }));
      } catch (e) {
        console.warn("Library thumbnail failed", e);
        cache.delete(k); // retry next time (e.g. once the renderer is ready)
        return null;
      }
    });
    chain = p;
    cache.set(k, p);
  }
  return p;
}

/** Free cached previews of removed items. */
export function dropThumbnails(ids: Iterable<string>) {
  for (const id of ids) {
    for (const dark of [false, true]) {
      const k = `${id}:${dark ? 1 : 0}`;
      cache.get(k)?.then((url) => url && URL.revokeObjectURL(url));
      cache.delete(k);
    }
  }
}
