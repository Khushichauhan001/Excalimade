// Geometry of every closed shape in element-local coordinates (0,0 → width,height).
// Used by the renderer (SVG path data for rough.js), hit-testing, binding and text layout.
import type { ExcalidrawElement, Point, ShapeType } from "../core/types";
import { SHAPE_TYPES } from "../core/types";

export const isShape = (el: { type: string }): el is ExcalidrawElement & { type: ShapeType } =>
  (SHAPE_TYPES as string[]).includes(el.type);

/** Corner radius used for "round" edges. */
export const getCornerRadius = (w: number, h: number) => Math.min(32, Math.min(Math.abs(w), Math.abs(h)) * 0.25);

/** Map points from their own bounding box onto [0,w]×[0,h]. */
function fitToBox(points: Point[], w: number, h: number): Point[] {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const sx = w / (Math.max(...xs) - minX || 1);
  const sy = h / (Math.max(...ys) - minY || 1);
  return points.map(([x, y]) => [(x - minX) * sx, (y - minY) * sy]);
}

const starPoints = (w: number, h: number): Point[] => {
  const pts: Point[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 1 : 0.42;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return fitToBox(pts, w, h);
};

export const cylinderCapHeight = (w: number, h: number) => Math.min(Math.abs(h) / 4, Math.abs(w) * 0.18 + 2);

/** Cloud = bumps (quadratic curves) around an ellipse, normalised to the box. */
function cloudGeometry(w: number, h: number) {
  const n = 9;
  const anchors: Point[] = [];
  const controls: Point[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    anchors.push([Math.cos(a), Math.sin(a) * 0.82]);
  }
  for (let i = 0; i < n; i++) {
    const [ax, ay] = anchors[i];
    const [bx, by] = anchors[(i + 1) % n];
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    const len = Math.hypot(mx, my) || 1;
    const bulge = 0.55;
    controls.push([mx + (mx / len) * bulge, my + (my / len) * bulge]);
  }
  // sample to find the real extent, then fit everything with the same transform
  const samples: Point[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = anchors[i], c = controls[i], p1 = anchors[(i + 1) % n];
    for (let t = 0; t < 1; t += 0.1) samples.push(quad(p0, c, p1, t));
  }
  const xs = samples.map((p) => p[0]), ys = samples.map((p) => p[1]);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const sx = w / (Math.max(...xs) - minX), sy = h / (Math.max(...ys) - minY);
  const map = ([x, y]: Point): Point => [(x - minX) * sx, (y - minY) * sy];
  return { anchors: anchors.map(map), controls: controls.map(map), samples: samples.map(map) };
}

const quad = (p0: Point, c: Point, p1: Point, t: number): Point => [
  (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * c[0] + t * t * p1[0],
  (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * c[1] + t * t * p1[1],
];

const calloutPoints = (w: number, h: number): Point[] => {
  const bh = h * 0.78;
  return [[0, 0], [w, 0], [w, bh], [w * 0.42, bh], [w * 0.2, h], [w * 0.24, bh], [0, bh]];
};

/** Polygon vertices for polygonal shapes (null for curved ones). */
export function getPolygon(type: ShapeType, w: number, h: number): Point[] | null {
  switch (type) {
    case "rectangle": return [[0, 0], [w, 0], [w, h], [0, h]];
    case "diamond": return [[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]];
    case "triangle": return [[w / 2, 0], [w, h], [0, h]];
    case "hexagon": return [[w * 0.25, 0], [w * 0.75, 0], [w, h / 2], [w * 0.75, h], [w * 0.25, h], [0, h / 2]];
    case "star": return starPoints(w, h);
    case "callout": return calloutPoints(w, h);
    default: return null;
  }
}

/** Outline as a closed polygon (curves sampled) — for hit-testing and binding. */
export function getShapeOutline(type: ShapeType, w: number, h: number): Point[] {
  const poly = getPolygon(type, w, h);
  if (poly) return poly;
  if (type === "ellipse") {
    const pts: Point[] = [];
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      pts.push([w / 2 + (Math.cos(a) * w) / 2, h / 2 + (Math.sin(a) * h) / 2]);
    }
    return pts;
  }
  if (type === "cylinder") {
    const ry = cylinderCapHeight(w, h);
    const pts: Point[] = [];
    for (let i = 0; i <= 16; i++) { const a = Math.PI + (i / 16) * Math.PI; pts.push([w / 2 + (Math.cos(a) * w) / 2, ry + Math.sin(a) * ry]); }
    for (let i = 0; i <= 16; i++) { const a = (i / 16) * Math.PI; pts.push([w / 2 + (Math.cos(a) * w) / 2, h - ry + Math.sin(a) * ry]); }
    return pts;
  }
  return cloudGeometry(w, h).samples; // cloud
}

/** Rounded polygon as SVG path data, using quadratic curves at the corners. */
function roundedPolygonPath(points: Point[], radius: number) {
  const n = points.length;
  let d = "";
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n], cur = points[i], next = points[(i + 1) % n];
    const lenPrev = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
    const lenNext = Math.hypot(next[0] - cur[0], next[1] - cur[1]);
    const r = Math.min(radius, lenPrev / 2, lenNext / 2);
    const a: Point = [cur[0] + ((prev[0] - cur[0]) * r) / (lenPrev || 1), cur[1] + ((prev[1] - cur[1]) * r) / (lenPrev || 1)];
    const b: Point = [cur[0] + ((next[0] - cur[0]) * r) / (lenNext || 1), cur[1] + ((next[1] - cur[1]) * r) / (lenNext || 1)];
    d += `${i === 0 ? "M" : "L"}${a[0]} ${a[1]} Q${cur[0]} ${cur[1]} ${b[0]} ${b[1]} `;
  }
  return d + "Z";
}

const polygonPath = (points: Point[]) => "M" + points.map((p) => `${p[0]} ${p[1]}`).join(" L") + " Z";

/**
 * SVG path data for the shape outline (used for both rough.js and plain canvas drawing).
 * Ellipse returns null (rough.js has a dedicated ellipse generator).
 * Cylinder returns the body; its top cap is drawn separately via `getCylinderCap`.
 */
export function getShapePath(type: ShapeType, w: number, h: number, round: boolean): string | null {
  const poly = getPolygon(type, w, h);
  if (poly) {
    if (!round) return polygonPath(poly);
    const r = type === "rectangle" || type === "callout" ? getCornerRadius(w, h) : Math.min(w, h) * (type === "star" ? 0.04 : 0.12);
    return roundedPolygonPath(poly, r);
  }
  if (type === "cylinder") {
    const ry = cylinderCapHeight(w, h), rx = w / 2;
    return `M0 ${ry} L0 ${h - ry} A${rx} ${ry} 0 0 0 ${w} ${h - ry} L${w} ${ry} A${rx} ${ry} 0 0 0 0 ${ry} Z`;
  }
  if (type === "cloud") {
    const { anchors, controls } = cloudGeometry(w, h);
    let d = `M${anchors[0][0]} ${anchors[0][1]} `;
    for (let i = 0; i < anchors.length; i++) {
      const c = controls[i], p = anchors[(i + 1) % anchors.length];
      d += `Q${c[0]} ${c[1]} ${p[0]} ${p[1]} `;
    }
    return d + "Z";
  }
  return null;
}

/** Cylinder top cap: full ellipse centre/size in local coordinates. */
export const getCylinderCap = (w: number, h: number) => {
  const ry = cylinderCapHeight(w, h);
  return { cx: w / 2, cy: ry, w, h: ry * 2 };
};

/** Area inside a container where its text label is laid out (local coordinates). */
export function getContainerTextBox(type: string, w: number, h: number) {
  const pad = 8;
  let box: { x: number; y: number; w: number; h: number };
  switch (type) {
    case "ellipse": {
      const k = 1 / Math.SQRT2;
      box = { x: (w * (1 - k)) / 2, y: (h * (1 - k)) / 2, w: w * k, h: h * k };
      break;
    }
    case "diamond": box = { x: w / 4, y: h / 4, w: w / 2, h: h / 2 }; break;
    case "triangle": box = { x: w / 4, y: h * 0.45, w: w / 2, h: h * 0.5 }; break;
    case "hexagon": box = { x: w * 0.18, y: h * 0.1, w: w * 0.64, h: h * 0.8 }; break;
    case "star": box = { x: w * 0.3, y: h * 0.32, w: w * 0.4, h: h * 0.42 }; break;
    case "cylinder": {
      const ry = cylinderCapHeight(w, h);
      box = { x: 0, y: ry * 2, w, h: h - ry * 3 };
      break;
    }
    case "cloud": box = { x: w * 0.18, y: h * 0.2, w: w * 0.64, h: h * 0.6 }; break;
    case "callout": box = { x: 0, y: 0, w, h: h * 0.78 }; break;
    default: box = { x: 0, y: 0, w, h };
  }
  return { x: box.x + pad, y: box.y + pad, w: Math.max(box.w - pad * 2, 10), h: Math.max(box.h - pad * 2, 10) };
}

/** Ratio container-size / text-box-size, used to grow a container to fit its text. */
export function getContainerGrowFactor(type: string) {
  const probe = getContainerTextBox(type, 1000, 1000);
  return { x: 1000 / (probe.w + 16), y: 1000 / (probe.h + 16) };
}
