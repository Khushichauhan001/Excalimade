import type { ExcalidrawElement, FreeDrawElement, LinearElement, Point } from "./types";
import { rotatePoint } from "./utils";

export type Bounds = [minX: number, minY: number, maxX: number, maxY: number];

export const isLinear = (el: ExcalidrawElement): el is LinearElement => el.type === "arrow" || el.type === "line";
export const hasPoints = (el: ExcalidrawElement): el is LinearElement | FreeDrawElement =>
  el.type === "arrow" || el.type === "line" || el.type === "freedraw";

/** Unrotated box in scene coordinates. For point-based elements it is the box of their points. */
export function getElementAbsCoords(el: ExcalidrawElement): Bounds {
  if (hasPoints(el)) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [px, py] of el.points) {
      minX = Math.min(minX, px); minY = Math.min(minY, py);
      maxX = Math.max(maxX, px); maxY = Math.max(maxY, py);
    }
    return [el.x + minX, el.y + minY, el.x + maxX, el.y + maxY];
  }
  return [el.x, el.y, el.x + el.width, el.y + el.height];
}

export const getElementCenter = (el: ExcalidrawElement): Point => {
  const [x1, y1, x2, y2] = getElementAbsCoords(el);
  return [(x1 + x2) / 2, (y1 + y2) / 2];
};

/** Absolute points of a linear / freedraw element, with rotation applied. */
export function getAbsolutePoints(el: LinearElement | FreeDrawElement): Point[] {
  const c = getElementCenter(el);
  return el.points.map(([px, py]) => rotatePoint([el.x + px, el.y + py], c, el.angle));
}

/** Axis-aligned bounds of the element including rotation. */
export function getElementBounds(el: ExcalidrawElement): Bounds {
  if (hasPoints(el)) {
    const pts = getAbsolutePoints(el);
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }
  const [x1, y1, x2, y2] = getElementAbsCoords(el);
  if (!el.angle) return [x1, y1, x2, y2];
  const c: Point = [(x1 + x2) / 2, (y1 + y2) / 2];
  const corners = ([[x1, y1], [x2, y1], [x2, y2], [x1, y2]] as Point[]).map((p) => rotatePoint(p, c, el.angle));
  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

export function getCommonBounds(elements: readonly ExcalidrawElement[]): Bounds {
  if (!elements.length) return [0, 0, 0, 0];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const el of elements) {
    const [a, b, c, d] = getElementBounds(el);
    minX = Math.min(minX, a); minY = Math.min(minY, b);
    maxX = Math.max(maxX, c); maxY = Math.max(maxY, d);
  }
  return [minX, minY, maxX, maxY];
}

export const boundsIntersect = (a: Bounds, b: Bounds) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
export const boundsContain = (outer: Bounds, inner: Bounds) =>
  inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3];

/** Distance from point p to segment ab. */
export function distanceToSegment(p: Point, a: Point, b: Point) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export const pointInPolygon = ([x, y]: Point, poly: Point[]) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

/** Visible area of the canvas in scene coordinates. */
export const getViewportBounds = (as: { scrollX: number; scrollY: number; zoom: number; width: number; height: number }): Bounds => [
  -as.scrollX,
  -as.scrollY,
  -as.scrollX + as.width / as.zoom,
  -as.scrollY + as.height / as.zoom,
];

export const isCurvedLinear = (el: LinearElement) =>
  el.points.length > 2 && (el.type === "arrow" ? el.arrowType === "round" : el.roundness === "round");

/** Catmull-Rom sampling (close to rough.js `curve`) of relative points. */
export function sampleCurve(points: Point[], segments = 12): Point[] {
  if (points.length < 3) return points.slice();
  const out: Point[] = [points[0]];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(i - 1, 0)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(i + 2, points.length - 1)];
    for (let s = 1; s <= segments; s++) {
      const t = s / segments, t2 = t * t, t3 = t2 * t;
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  return out;
}

/** The rendered path of a linear element as an absolute polyline (curves sampled, rotation applied). */
export function getLinearPolyline(el: LinearElement): Point[] {
  const rel = isCurvedLinear(el) ? sampleCurve(el.points) : el.points;
  const c = getElementCenter(el);
  return rel.map(([px, py]) => rotatePoint([el.x + px, el.y + py], c, el.angle));
}

/** Point at fraction t (0..1) of a polyline's length. */
export function pointAlongPolyline(pts: Point[], t: number): Point {
  if (pts.length === 1) return pts[0];
  let total = 0;
  const lens: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    lens.push(l);
    total += l;
  }
  let target = total * t;
  for (let i = 0; i < lens.length; i++) {
    if (target <= lens[i] || i === lens.length - 1) {
      const k = lens[i] ? Math.min(1, target / lens[i]) : 0;
      return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k];
    }
    target -= lens[i];
  }
  return pts[pts.length - 1];
}

/** Intersection of segment p→q with segment a→b (or null). */
export function segmentIntersection(p: Point, q: Point, a: Point, b: Point): Point | null {
  const r: Point = [q[0] - p[0], q[1] - p[1]];
  const s: Point = [b[0] - a[0], b[1] - a[1]];
  const denom = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((a[0] - p[0]) * s[1] - (a[1] - p[1]) * s[0]) / denom;
  const u = ((a[0] - p[0]) * r[1] - (a[1] - p[1]) * r[0]) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [p[0] + t * r[0], p[1] + t * r[1]] : null;
}
