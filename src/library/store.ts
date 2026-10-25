// Personal library: zustand store persisted (gzip JSON) to IndexedDB, synced across tabs.
import { create } from "zustand";
import type { ExcalidrawElement, LibraryItem } from "../core/types";
import { getState, showToast } from "../core/store";
import { duplicateElements, insertElements } from "../core/elements";
import { getCommonBounds } from "../core/geometry";
import { randomId, gzip, gunzip, viewportToScene } from "../core/utils";
import { idbGet, idbSet, isQuotaError } from "../io/idb";
import { itemSignature, parseLibrary } from "./format";

interface LibraryStore {
  items: LibraryItem[];
  loaded: boolean;
  /** Sidebar tab: personal items or the public libraries browser. */
  tab: "mine" | "browse";
}

export const useLibrary = create<LibraryStore>(() => ({ items: [], loaded: false, tab: "mine" }));

const KEY = "items";
const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("excalimade-library") : null;

let loadPromise: Promise<void> | null = null;
export function loadLibrary(force = false) {
  if (loadPromise && !force) return loadPromise;
  loadPromise = (async () => {
    try {
      const raw = await idbGet<Uint8Array>("library", KEY);
      const items = raw ? (JSON.parse(await gunzip(raw)) as LibraryItem[]) : [];
      // stored items were restored when added, but re-validate in case the format changed
      useLibrary.setState({ items: items.length ? parseLibrary({ libraryItems: items }) : [], loaded: true });
    } catch (e) {
      console.warn("Library load failed", e);
      useLibrary.setState({ loaded: true });
    }
  })();
  return loadPromise;
}

channel?.addEventListener("message", (e) => {
  if (e.data === "changed") void loadLibrary(true);
});

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await idbSet("library", KEY, await gzip(JSON.stringify(useLibrary.getState().items)));
      channel?.postMessage("changed");
    } catch (e) {
      showToast(isQuotaError(e) ? "Storage is full — couldn't save the library." : "Couldn't save the library.", "error");
    }
  }, 250);
}

const setItems = (items: LibraryItem[]) => {
  useLibrary.setState({ items });
  persist();
};

/** Add items (newest first). Skips duplicates. Returns how many were added. */
export async function addLibraryItems(items: LibraryItem[]): Promise<number> {
  await loadLibrary();
  const existing = useLibrary.getState().items;
  const ids = new Set(existing.map((i) => i.id));
  const sigs = new Set(existing.map((i) => itemSignature(i.elements)));
  const fresh: LibraryItem[] = [];
  for (const it of items) {
    const sig = itemSignature(it.elements);
    if (sigs.has(sig)) continue;
    sigs.add(sig);
    fresh.push(ids.has(it.id) ? { ...it, id: randomId() } : it);
  }
  if (fresh.length) setItems([...fresh, ...existing]);
  return fresh.length;
}

/** Store the given scene elements (plus their bound labels) as one library item. */
export async function addElementsToLibrary(elements: ExcalidrawElement[], name = "") {
  if (!elements.length) return;
  const all = getState().elements;
  const ids = new Set(elements.map((e) => e.id));
  // include bound text labels and frame children so the item is complete
  for (const el of all) {
    if (el.isDeleted || ids.has(el.id)) continue;
    if ((el.type === "text" && el.containerId && ids.has(el.containerId)) || (el.frameId && ids.has(el.frameId))) ids.add(el.id);
  }
  const picked = all.filter((e) => ids.has(e.id) && !e.isDeleted);
  // detach from frames/bindings that are not part of the item
  const clean = picked.map((e) => ({ ...e, frameId: e.frameId && ids.has(e.frameId) ? e.frameId : null })) as ExcalidrawElement[];
  const n = await addLibraryItems([
    { id: randomId(), name, status: "unpublished", created: Date.now(), elements: duplicateElements(clean) },
  ]);
  showToast(n ? "Added to library" : "This item is already in your library", n ? "success" : "info");
}

export function removeLibraryItems(ids: Set<string>) {
  setItems(useLibrary.getState().items.filter((i) => !ids.has(i.id)));
}

export function renameLibraryItem(id: string, name: string) {
  setItems(useLibrary.getState().items.map((i) => (i.id === id ? { ...i, name } : i)));
}

export function resetLibrary() {
  setItems([]);
}

export const getLibraryItem = (id: string) => useLibrary.getState().items.find((i) => i.id === id);

/** Insert library items into the scene — at a client point, or the viewport centre. */
export function insertLibraryItems(items: LibraryItem[], clientPoint?: { x: number; y: number }) {
  if (!items.length) return;
  const els: ExcalidrawElement[] = [];
  let offsetX = 0;
  // place multiple items side by side
  for (const it of items) {
    const copy = duplicateElements(it.elements);
    const [x1, , x2] = getCommonBounds(copy);
    els.push(...copy.map((e) => ({ ...e, x: e.x - x1 + offsetX })));
    offsetX += x2 - x1 + 40;
  }
  if (clientPoint) {
    const [sx, sy] = viewportToScene(clientPoint.x, clientPoint.y, getState().appState);
    const [x1, y1, x2, y2] = getCommonBounds(els);
    const dx = sx - (x1 + x2) / 2;
    const dy = sy - (y1 + y2) / 2;
    insertElements(els.map((e) => ({ ...e, x: e.x + dx, y: e.y + dy })), { select: true, centerInView: false });
  } else {
    insertElements(els, { select: true, centerInView: true });
  }
}

/** Custom drag MIME carrying a JSON list of library item ids. */
export const LIBRARY_DRAG_MIME = "application/vnd.excalimade.library-items+json";
