// .excalidrawlib read/write (v1 `library: [[…elements]]` and v2 `libraryItems`).
import type { ExcalidrawElement, LibraryItem } from "../core/types";
import { restoreElements, SCENE_SOURCE, toCompatElement } from "../io/serialize";
import { randomId } from "../core/utils";

export class InvalidLibraryError extends Error {}

export function parseLibrary(input: string | unknown): LibraryItem[] {
  let data: unknown = input;
  if (typeof input === "string") {
    try {
      data = JSON.parse(input);
    } catch {
      throw new InvalidLibraryError("The library file is not valid JSON.");
    }
  }
  if (!data || typeof data !== "object") throw new InvalidLibraryError("Invalid library file.");
  const d = data as Record<string, unknown>;
  if (d.type !== undefined && d.type !== "excalidrawlib") throw new InvalidLibraryError("Not an Excalidraw library file.");
  const items: LibraryItem[] = [];
  if (Array.isArray(d.libraryItems)) {
    for (const raw of d.libraryItems as Record<string, unknown>[]) {
      if (!raw || typeof raw !== "object") continue;
      // some v2 files store items as bare element arrays
      const elsRaw = Array.isArray(raw) ? raw : raw.elements;
      const elements = restoreElements(elsRaw);
      if (!elements.length) continue;
      items.push({
        id: typeof raw.id === "string" ? raw.id : randomId(),
        name: typeof raw.name === "string" ? raw.name : "",
        status: raw.status === "published" ? "published" : "unpublished",
        created: typeof raw.created === "number" ? raw.created : Date.now(),
        elements,
      });
    }
  } else if (Array.isArray(d.library)) {
    for (const group of d.library) {
      const elements = restoreElements(group);
      if (elements.length) items.push({ id: randomId(), name: "", status: "unpublished", created: Date.now(), elements });
    }
  } else {
    throw new InvalidLibraryError("The file contains no library items.");
  }
  return items;
}

export function serializeLibrary(items: LibraryItem[]): string {
  return JSON.stringify({
    type: "excalidrawlib",
    version: 2,
    source: SCENE_SOURCE,
    libraryItems: items.map((it) => ({
      id: it.id,
      status: it.status,
      created: it.created,
      name: it.name,
      elements: it.elements.map(toCompatElement), // so excalidraw.com can open our libraries
    })),
  });
}

/** Position-independent fingerprint used to avoid importing the same item twice. */
export function itemSignature(elements: ExcalidrawElement[]) {
  const minX = Math.min(...elements.map((e) => e.x));
  const minY = Math.min(...elements.map((e) => e.y));
  return elements
    .map((e) => {
      const extra =
        e.type === "text" ? (e as { text: string }).text : "points" in e ? (e.points as unknown[]).length : "";
      return `${e.type}:${Math.round(e.x - minX)},${Math.round(e.y - minY)},${Math.round(e.width)},${Math.round(e.height)}:${e.strokeColor}:${e.backgroundColor}:${extra}`;
    })
    .join("|");
}
