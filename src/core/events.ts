// Tiny typed event bus for cross-module hooks that don't belong in the store.
import type { ExcalidrawElement, Point, ToolType } from "./types";

export interface EventMap {
  /** Local pointer moved over the canvas (scene coords). Collab broadcasts this. */
  pointer: { x: number; y: number; tool: ToolType; down: boolean };
  /** Local pointer left the canvas. */
  pointerLeave: void;
  /** A scene was loaded from file / link / cloud — modules may reset state (e.g. history). */
  sceneLoaded: { source: "file" | "link" | "cloud" | "local" | "collab" };
  /** Ask the canvas to start dragging new elements in at a client point (library drag & drop). */
  insertAtPoint: { elements: ExcalidrawElement[]; clientX: number; clientY: number };
  /** Request the inline text editor for an element (e.g. after creating a text from a dialog). */
  editText: { elementId: string };
  /** Canvas clicked with no tool consuming it (scene coords) — used by comment mode. */
  canvasClick: { point: Point; clientX: number; clientY: number };
}

type Handler<K extends keyof EventMap> = (payload: EventMap[K]) => void;
const handlers: { [K in keyof EventMap]?: Set<Handler<K>> } = {};

export function on<K extends keyof EventMap>(event: K, fn: Handler<K>) {
  ((handlers[event] ??= new Set() as any) as Set<Handler<K>>).add(fn);
  return () => void (handlers[event] as Set<Handler<K>>).delete(fn);
}

export function emit<K extends keyof EventMap>(event: K, payload: EventMap[K]) {
  (handlers[event] as Set<Handler<K>> | undefined)?.forEach((fn) => fn(payload));
}

/**
 * Paste interceptors run (in registration order, highest priority first) before the canvas'
 * default paste handling (elements JSON, images, plain text). Return true to consume the paste.
 * `text` is the clipboard plain text, `files` the clipboard files.
 */
export type PasteHandler = (data: { text: string; html: string; files: File[] }) => boolean | Promise<boolean>;
const pasteHandlers: { priority: number; fn: PasteHandler }[] = [];
export const registerPasteHandler = (fn: PasteHandler, priority = 0) => {
  pasteHandlers.push({ fn, priority });
  pasteHandlers.sort((a, b) => b.priority - a.priority);
  return () => {
    const i = pasteHandlers.findIndex((h) => h.fn === fn);
    if (i >= 0) pasteHandlers.splice(i, 1);
  };
};
export const getPasteHandlers = () => pasteHandlers.map((h) => h.fn);
