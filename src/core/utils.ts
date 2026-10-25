import { nanoid } from "nanoid";
import type { AppState, Point } from "./types";

export const randomId = () => nanoid();
export const randomInteger = () => Math.floor(Math.random() * 2 ** 31);

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
/** Label for the primary modifier key in shortcut hints. */
export const CMD = isMac ? "⌘" : "Ctrl";

/** Screen (client) coordinates → scene coordinates. */
export const viewportToScene = (
  x: number,
  y: number,
  { scrollX, scrollY, zoom }: Pick<AppState, "scrollX" | "scrollY" | "zoom">,
): Point => [x / zoom - scrollX, y / zoom - scrollY];

/** Scene coordinates → screen (client) coordinates. */
export const sceneToViewport = (
  x: number,
  y: number,
  { scrollX, scrollY, zoom }: Pick<AppState, "scrollX" | "scrollY" | "zoom">,
): Point => [(x + scrollX) * zoom, (y + scrollY) * zoom];

export const rotatePoint = ([x, y]: Point, [cx, cy]: Point, angle: number): Point => {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [(x - cx) * cos - (y - cy) * sin + cx, (x - cx) * sin + (y - cy) * cos + cy];
};

export const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export const debounce = <A extends unknown[]>(fn: (...args: A) => void, ms: number) => {
  let t: ReturnType<typeof setTimeout> | undefined;
  const d = (...args: A) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  d.flush = () => clearTimeout(t);
  return d;
};

export const isInputTarget = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);

/** gzip a string → bytes using the native CompressionStream (keeps storage small). */
export async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
export async function gunzip(bytes: Uint8Array | ArrayBuffer): Promise<string> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

export const bytesToBase64 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
export const base64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
