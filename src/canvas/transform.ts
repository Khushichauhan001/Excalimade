// Transform handles + resize / rotate maths for single and multiple elements.
import type { ExcalidrawElement, FreeDrawElement, ImageElement, LinearElement, Point, TextElement } from "../core/types";
import { getCommonBounds, getElementAbsCoords, hasPoints } from "../core/geometry";
import { measureText, wrapText } from "../core/text";
import { rotatePoint } from "../core/utils";
import type { HandleName } from "./session";

export interface TransformBox {
  x: number;
  y: number;
  w: number;
  h: number;
  angle: number;
}

/** Elements that are resized with a transform box (2-point lines use point handles instead). */
export const usesPointHandles = (el: ExcalidrawElement) => (el.type === "arrow" || el.type === "line") && (el as LinearElement).points.length <= 2;

export function getTransformBox(selected: ExcalidrawElement[]): TransformBox | null {
  if (!selected.length) return null;
  if (selected.length === 1) {
    const el = selected[0];
    if (usesPointHandles(el)) return null;
    const [x1, y1, x2, y2] = getElementAbsCoords(el);
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1, angle: el.angle };
  }
  const [x1, y1, x2, y2] = getCommonBounds(selected);
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1, angle: 0 };
}

export const ROTATION_HANDLE_GAP = 22;

/** Handle centres in scene coords. Side handles are omitted for tiny boxes. */
export function getHandles(box: TransformBox, zoom: number, opts: { sides?: boolean; vertical?: boolean; rotation?: boolean } = {}) {
  const { x, y, w, h, angle } = box;
  const pad = 4 / zoom;
  const x1 = x - pad, y1 = y - pad, x2 = x + w + pad, y2 = y + h + pad;
  const c: Point = [x + w / 2, y + h / 2];
  const local: Partial<Record<HandleName, Point>> = {
    nw: [x1, y1], ne: [x2, y1], sw: [x1, y2], se: [x2, y2],
  };
  const showSides = opts.sides !== false && w * zoom > 48 && h * zoom > 48;
  if (showSides) {
    local.e = [x2, c[1]];
    local.w = [x1, c[1]];
    if (opts.vertical !== false) {
      local.n = [c[0], y1];
      local.s = [c[0], y2];
    }
  } else if (opts.sides !== false && opts.vertical === false) {
    local.e = [x2, c[1]];
    local.w = [x1, c[1]];
  }
  if (opts.rotation !== false) local.rotation = [c[0], y1 - ROTATION_HANDLE_GAP / zoom];
  const out: Partial<Record<HandleName, Point>> = {};
  for (const [k, p] of Object.entries(local) as [HandleName, Point][]) out[k] = rotatePoint(p, c, angle);
  return out;
}

export function getHandleAt(handles: Partial<Record<HandleName, Point>>, p: Point, zoom: number, touch = false): HandleName | null {
  const r = (touch ? 16 : 8) / zoom;
  // rotation first (it sits outside), then corners, then sides
  const order: HandleName[] = ["rotation", "nw", "ne", "sw", "se", "n", "s", "e", "w"];
  for (const k of order) {
    const h = handles[k];
    if (h && Math.abs(p[0] - h[0]) <= r && Math.abs(p[1] - h[1]) <= r) return k;
  }
  return null;
}

/** CSS cursor for a handle, accounting for rotation. */
export function handleCursor(handle: HandleName, angle: number) {
  if (handle === "rotation") return "grab";
  const dirs = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];
  const cursors = ["ns-resize", "nesw-resize", "ew-resize", "nwse-resize"];
  const idx = (dirs.indexOf(handle) + Math.round((((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / (Math.PI / 4))) % 8;
  return cursors[idx % 4];
}

interface ResizeMods {
  shift: boolean;
  alt: boolean;
}

/** New box edges (in the box's unrotated frame) for a handle drag. */
function resizeEdges(box: TransformBox, handle: HandleName, pointer: Point, mods: ResizeMods, keepAspect: boolean) {
  const c0: Point = [box.x + box.w / 2, box.y + box.h / 2];
  const p = rotatePoint(pointer, c0, -box.angle);
  let x1 = box.x, y1 = box.y, x2 = box.x + box.w, y2 = box.y + box.h;
  if (handle.includes("e")) x2 = p[0];
  if (handle.includes("w")) x1 = p[0];
  if (handle.includes("n")) y1 = p[1];
  if (handle.includes("s")) y2 = p[1];
  if (mods.alt) {
    if (handle.includes("e")) x1 = 2 * c0[0] - x2;
    if (handle.includes("w")) x2 = 2 * c0[0] - x1;
    if (handle.includes("n")) y2 = 2 * c0[1] - y1;
    if (handle.includes("s")) y1 = 2 * c0[1] - y2;
  }
  if (keepAspect && box.w > 0 && box.h > 0) {
    const ratio = box.w / box.h;
    let nw = x2 - x1, nh = y2 - y1;
    const corner = handle.length === 2;
    if (corner) {
      if (Math.abs(nw) / box.w > Math.abs(nh) / box.h) nh = Math.sign(nh || 1) * Math.abs(nw) / ratio;
      else nw = Math.sign(nw || 1) * Math.abs(nh) * ratio;
    } else if (handle === "e" || handle === "w") nh = Math.abs(nw) / ratio;
    else nw = Math.abs(nh) * ratio;
    // re-anchor: opposite edge stays fixed (or centre with alt)
    if (mods.alt) {
      x1 = c0[0] - nw / 2; x2 = c0[0] + nw / 2; y1 = c0[1] - nh / 2; y2 = c0[1] + nh / 2;
    } else {
      if (handle.includes("w")) x1 = x2 - nw; else if (handle.includes("e")) x2 = x1 + nw; else { x1 = c0[0] - nw / 2; x2 = c0[0] + nw / 2; }
      if (handle.includes("n")) y1 = y2 - nh; else if (handle.includes("s")) y2 = y1 + nh; else { y1 = c0[1] - nh / 2; y2 = c0[1] + nh / 2; }
    }
  }
  return { x1, y1, x2, y2, c0 };
}

/** Resize a single element. Returns the patched element. */
export function resizeSingle(orig: ExcalidrawElement, handle: HandleName, pointer: Point, mods: ResizeMods): ExcalidrawElement {
  const box = getTransformBox([orig])!;
  const isText = orig.type === "text";
  const keepAspect = isText ? handle.length === 2 : orig.type === "image" ? !mods.shift : mods.shift;
  let { x1, y1, x2, y2, c0 } = resizeEdges(box, handle, pointer, mods, keepAspect);
  const minSize = 1;
  if (Math.abs(x2 - x1) < minSize) x2 = x1 + (x2 >= x1 ? minSize : -minSize);
  if (Math.abs(y2 - y1) < minSize) y2 = y1 + (y2 >= y1 ? minSize : -minSize);
  const nw = x2 - x1, nh = y2 - y1;
  // centre of new box, in scene coords (rotation about the old centre)
  const ncLocal: Point = [(x1 + x2) / 2, (y1 + y2) / 2];
  const nc = rotatePoint(ncLocal, c0, box.angle);
  const shift: Point = [nc[0] - ncLocal[0], nc[1] - ncLocal[1]];

  if (isText) {
    const t = orig as TextElement;
    if (handle === "e" || handle === "w") {
      const width = Math.max(Math.abs(nw), t.fontSize);
      const text = wrapText(t.originalText, t.fontSize, t.fontFamily, width);
      const height = measureText(text, t.fontSize, t.fontFamily, t.lineHeight).height;
      const left = Math.min(x1, x2);
      return { ...t, text, width, height, autoResize: false, x: left + shift[0], y: Math.min(y1, y2) + shift[1] } as TextElement;
    }
    const scale = Math.abs(nw) / box.w;
    const fontSize = Math.max(4, t.fontSize * scale);
    const m = t.autoResize ? measureText(t.text, fontSize, t.fontFamily, t.lineHeight) : { width: t.width * scale, height: t.height * scale };
    const left = Math.min(x1, x2), top = Math.min(y1, y2);
    return { ...t, fontSize, width: m.width, height: m.height, x: left + shift[0], y: top + shift[1] } as TextElement;
  }

  if (hasPoints(orig)) {
    const el = orig as LinearElement | FreeDrawElement;
    const sx = box.w ? nw / box.w : 1;
    const sy = box.h ? nh / box.h : 1;
    const abs = el.points.map(([px, py]): Point => [
      x1 + (el.x + px - box.x) * sx + shift[0],
      y1 + (el.y + py - box.y) * sy + shift[1],
    ]);
    const [fx, fy] = abs[0];
    const points = abs.map(([ax, ay]) => [ax - fx, ay - fy] as Point);
    const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
    return { ...el, x: fx, y: fy, points, width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) } as ExcalidrawElement;
  }

  const patch: Partial<ExcalidrawElement> & { scale?: [number, number] } = {
    x: Math.min(x1, x2) + shift[0],
    y: Math.min(y1, y2) + shift[1],
    width: Math.abs(nw),
    height: Math.abs(nh),
  };
  if (orig.type === "image") {
    const img = orig as ImageElement;
    patch.scale = [img.scale[0] * (nw < 0 ? -1 : 1), img.scale[1] * (nh < 0 ? -1 : 1)];
  }
  return { ...orig, ...patch } as ExcalidrawElement;
}

/** Resize a multi-element selection by scaling about the box anchor. */
export function resizeMultiple(origs: ExcalidrawElement[], handle: HandleName, pointer: Point, mods: ResizeMods): ExcalidrawElement[] {
  const box = getTransformBox(origs)!;
  const uniform = mods.shift || origs.some((e) => e.type === "text" || e.type === "image" || e.angle !== 0);
  const { x1, y1, x2, y2 } = resizeEdges(box, handle, pointer, mods, uniform);
  const sx = box.w ? (x2 - x1) / box.w : 1;
  const sy = box.h ? (y2 - y1) / box.h : 1;
  if (Math.abs(sx) < 0.01 || Math.abs(sy) < 0.01) return origs;
  const mapX = (x: number) => x1 + (x - box.x) * sx;
  const mapY = (y: number) => y1 + (y - box.y) * sy;
  return origs.map((el) => {
    if (hasPoints(el)) {
      const p = el as LinearElement | FreeDrawElement;
      const abs = p.points.map(([px, py]): Point => [mapX(p.x + px), mapY(p.y + py)]);
      const [fx, fy] = abs[0];
      const points = abs.map(([ax, ay]) => [ax - fx, ay - fy] as Point);
      const xs = points.map((q) => q[0]), ys = points.map((q) => q[1]);
      return { ...p, x: fx, y: fy, points, width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) } as ExcalidrawElement;
    }
    const [ex1, ey1, ex2, ey2] = getElementAbsCoords(el);
    const cx = mapX((ex1 + ex2) / 2), cy = mapY((ey1 + ey2) / 2);
    const w = el.width * Math.abs(sx), h = el.height * Math.abs(sy);
    const out: any = { ...el, x: cx - w / 2, y: cy - h / 2, width: w, height: h };
    if (el.type === "text") out.fontSize = Math.max(4, (el as TextElement).fontSize * Math.abs(sx));
    if (el.type === "image") out.scale = [(el as ImageElement).scale[0] * Math.sign(sx), (el as ImageElement).scale[1] * Math.sign(sy)];
    return out as ExcalidrawElement;
  });
}

const SNAP_ANGLE = Math.PI / 12; // 15°

/** Rotate elements about the selection centre. `startAngle` = pointer angle at gesture start. */
export function rotateElements(origs: ExcalidrawElement[], pointer: Point, startPointerAngle: number, snap: boolean): ExcalidrawElement[] {
  const box = getTransformBox(origs.length === 1 && usesPointHandles(origs[0]) ? [] : origs) ?? (() => {
    const [x1, y1, x2, y2] = getCommonBounds(origs);
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1, angle: 0 };
  })();
  const c: Point = [box.x + box.w / 2, box.y + box.h / 2];
  const pointerAngle = Math.atan2(pointer[1] - c[1], pointer[0] - c[0]);
  if (origs.length === 1) {
    let angle = pointerAngle + Math.PI / 2;
    if (snap) angle = Math.round(angle / SNAP_ANGLE) * SNAP_ANGLE;
    angle = ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    return [{ ...origs[0], angle }];
  }
  let delta = pointerAngle - startPointerAngle;
  if (snap) delta = Math.round(delta / SNAP_ANGLE) * SNAP_ANGLE;
  return origs.map((el) => {
    const [ex1, ey1, ex2, ey2] = getElementAbsCoords(el);
    const ec: Point = [(ex1 + ex2) / 2, (ey1 + ey2) / 2];
    const nc = rotatePoint(ec, c, delta);
    const angle = (((el.angle + delta) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    return { ...el, x: el.x + nc[0] - ec[0], y: el.y + nc[1] - ec[1], angle };
  });
}
