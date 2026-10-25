import type { ExcalidrawElement, FrameElement, FreeDrawElement, LinearElement, Point, TextElement } from "../core/types";
import {
  distanceToSegment,
  getElementCenter,
  getLinearPolyline,
  getAbsolutePoints,
  pointInPolygon,
  getElementBounds,
} from "../core/geometry";
import { getAbsoluteOutline } from "../core/binding";
import { isShape } from "../render/shapes";
import { isTransparent } from "../render/rough";
import { rotatePoint } from "../core/utils";
import { FRAME_NAME_FONT, getFrameName } from "../render/scene";
import { measureLine } from "../core/text";

/** Point in the element's unrotated local frame (origin at x,y). */
export const toLocal = (el: ExcalidrawElement, p: Point): Point => {
  const c = getElementCenter(el);
  const r = rotatePoint(p, c, -el.angle);
  return [r[0] - el.x, r[1] - el.y];
};

const nearPolyline = (pts: Point[], p: Point, tol: number, closed = false) => {
  for (let i = 0; i < pts.length - 1; i++) if (distanceToSegment(p, pts[i], pts[i + 1]) <= tol) return true;
  return closed && pts.length > 2 && distanceToSegment(p, pts[pts.length - 1], pts[0]) <= tol;
};

/** Screen-space rectangle of a frame's name label, in scene coordinates. */
export function getFrameNameBounds(f: FrameElement, zoom: number, index?: number) {
  const w = Math.min(measureLine(getFrameName(f, index), FRAME_NAME_FONT) + 4, f.width * zoom) / zoom;
  const h = 22 / zoom;
  return { x: f.x, y: f.y - h, w, h };
}

/**
 * Hit-test one element. `tol` is in scene units (already divided by zoom).
 * Transparent shapes are only hit on their outline unless `inside` is true (e.g. when already selected).
 */
export function hitTest(el: ExcalidrawElement, p: Point, tol: number, inside = false, zoom = 1): boolean {
  if (el.isDeleted) return false;
  const [bx1, by1, bx2, by2] = getElementBounds(el);
  const pad = tol + el.strokeWidth;
  if (el.type !== "frame" && (p[0] < bx1 - pad || p[0] > bx2 + pad || p[1] < by1 - pad || p[1] > by2 + pad)) return false;

  if (isShape(el)) {
    const outline = getAbsoluteOutline(el);
    const filled = !isTransparent(el.backgroundColor) || el.boundElements.some((b) => b.type === "text");
    if ((filled || inside) && pointInPolygon(p, outline)) return true;
    return nearPolyline(outline, p, tol + el.strokeWidth / 2, true);
  }
  switch (el.type) {
    case "arrow":
    case "line": {
      const lin = el as LinearElement;
      const poly = getLinearPolyline(lin);
      if (lin.polygon && (inside || !isTransparent(lin.backgroundColor)) && pointInPolygon(p, poly)) return true;
      return nearPolyline(poly, p, tol + lin.strokeWidth / 2 + 2);
    }
    case "freedraw": {
      const pts = getAbsolutePoints(el as FreeDrawElement);
      if (pts.length === 1) return Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]) <= tol + el.strokeWidth * 2;
      return nearPolyline(pts, p, tol + el.strokeWidth * 2);
    }
    case "frame": {
      const f = el as FrameElement;
      const nb = getFrameNameBounds(f, zoom);
      if (p[0] >= nb.x && p[0] <= nb.x + nb.w && p[1] >= nb.y && p[1] <= nb.y + nb.h) return true;
      const local = toLocal(el, p);
      if (inside) return local[0] >= -tol && local[1] >= -tol && local[0] <= el.width + tol && local[1] <= el.height + tol;
      return nearPolyline(getAbsoluteOutline(el), p, tol, true);
    }
    default: {
      // text, image, embeddable: the whole box is hittable
      const [lx, ly] = toLocal(el, p);
      return lx >= -tol && ly >= -tol && lx <= el.width + tol && ly <= el.height + tol;
    }
  }
}

/**
 * Topmost element at a point. Text labels resolve to their container. Locked elements are skipped
 * unless `includeLocked`. Frames are only hit on their name label / edge.
 */
export function getElementAtPoint(
  elements: readonly ExcalidrawElement[],
  p: Point,
  zoom: number,
  opts: { selectedIds?: Record<string, true>; includeLocked?: boolean } = {},
): ExcalidrawElement | null {
  const tol = 6 / zoom;
  const byId = new Map(elements.map((e) => [e.id, e]));
  // selected elements win first if hit on their body (makes dragging transparent shapes easy)
  if (opts.selectedIds) {
    for (let i = elements.length - 1; i >= 0; i--) {
      const el = elements[i];
      if (opts.selectedIds[el.id] && !el.isDeleted && (!el.locked || opts.includeLocked) && el.type !== "frame" && hitTest(el, p, tol, true, zoom)) {
        return el;
      }
    }
  }
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (el.isDeleted || (el.locked && !opts.includeLocked)) continue;
    if (!hitTest(el, p, tol, false, zoom)) continue;
    if (el.type === "text" && (el as TextElement).containerId) {
      const c = byId.get((el as TextElement).containerId!);
      if (c && !c.isDeleted) return c;
    }
    // elements inside a frame are not hittable outside the frame (they are clipped)
    if (el.frameId) {
      const f = byId.get(el.frameId);
      if (f && !f.isDeleted && (p[0] < f.x || p[1] < f.y || p[0] > f.x + f.width || p[1] > f.y + f.height)) continue;
    }
    return el;
  }
  return null;
}

/** All elements hit by a segment (eraser). */
export function getElementsCrossingSegment(elements: readonly ExcalidrawElement[], a: Point, b: Point, zoom: number) {
  const tol = 4 / zoom;
  const out: ExcalidrawElement[] = [];
  const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (4 / zoom)));
  for (const el of elements) {
    if (el.isDeleted || el.locked) continue;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const p: Point = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      if (hitTest(el, p, tol, el.type === "text" || el.type === "image", zoom)) {
        out.push(el);
        break;
      }
    }
  }
  return out;
}
