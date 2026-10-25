// Arrow binding (arrows follow the shapes they connect) and container text layout.
import type { Binding, ExcalidrawElement, LinearElement, Point, TextElement } from "./types";
import { getElementCenter, getLinearPolyline, isLinear, pointAlongPolyline, segmentIntersection } from "./geometry";
import { getContainerGrowFactor, getContainerTextBox, getShapeOutline, isShape } from "../render/shapes";
import { measureText, wrapText } from "./text";
import { randomInteger, rotatePoint } from "./utils";

type Heading = [number, number]; // unit vector: [1,0] right, [0,1] down …

const bump = <T extends ExcalidrawElement>(el: T, patch: Partial<T>): T =>
  ({ ...el, ...patch, version: el.version + 1, versionNonce: randomInteger(), updated: Date.now() }) as T;

/** Absolute outline polygon of a bindable element (rotation applied). */
export function getAbsoluteOutline(el: ExcalidrawElement): Point[] {
  const local: Point[] = isShape(el)
    ? getShapeOutline(el.type, el.width, el.height)
    : [[0, 0], [el.width, 0], [el.width, el.height], [0, el.height]];
  const c = getElementCenter(el);
  return local.map(([x, y]) => rotatePoint([el.x + x, el.y + y], c, el.angle));
}

export const isBindable = (el: ExcalidrawElement) =>
  !el.isDeleted && (isShape(el) || el.type === "text" || el.type === "image" || el.type === "frame" || el.type === "embeddable") &&
  !(el.type === "text" && (el as TextElement).containerId);

/** Where an arrow end bound to `target` sits, aiming from `from` towards the target. */
export function getBindingPoint(target: ExcalidrawElement, binding: Binding, from: Point): { point: Point; heading: Heading } {
  const c = getElementCenter(target);
  if (binding.fixedPoint) {
    const [fx, fy] = binding.fixedPoint;
    const local: Point = [target.x + fx * target.width, target.y + fy * target.height];
    const heading = headingForFixedPoint(binding.fixedPoint, target.angle);
    const p = rotatePoint(local, c, target.angle);
    return { point: [p[0] + heading[0] * binding.gap, p[1] + heading[1] * binding.gap], heading };
  }
  const outline = getAbsoluteOutline(target);
  // ray from centre through `from`, extended well past the shape
  let dx = from[0] - c[0], dy = from[1] - c[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) { dx = 1; dy = 0; } else { dx /= len; dy /= len; }
  const far: Point = [c[0] + dx * 1e5, c[1] + dy * 1e5];
  let best: Point | null = null;
  let bestD = Infinity;
  for (let i = 0; i < outline.length; i++) {
    const hit = segmentIntersection(c, far, outline[i], outline[(i + 1) % outline.length]);
    if (hit) {
      const d = Math.hypot(hit[0] - c[0], hit[1] - c[1]);
      if (d > 0 && d < bestD) { bestD = d; best = hit; }
    }
  }
  const edge = best ?? c;
  const point: Point = [edge[0] + dx * binding.gap, edge[1] + dy * binding.gap];
  return { point, heading: Math.abs(dx) > Math.abs(dy) ? [Math.sign(dx), 0] : [0, Math.sign(dy)] };
}

function headingForFixedPoint([fx, fy]: Point, angle: number): Heading {
  // pick the box side the anchor is closest to
  const d = [fx, 1 - fx, fy, 1 - fy];
  const i = d.indexOf(Math.min(...d));
  const h: Point = i === 0 ? [-1, 0] : i === 1 ? [1, 0] : i === 2 ? [0, -1] : [0, 1];
  if (!angle) return h;
  const r = rotatePoint(h, [0, 0], angle);
  return Math.abs(r[0]) > Math.abs(r[1]) ? [Math.sign(r[0]), 0] : [0, Math.sign(r[1])];
}

/** Orthogonal route between two points with exit/entry headings. */
export function routeElbow(s: Point, sh: Heading | null, e: Point, eh: Heading | null): Point[] {
  const PAD = 28;
  const dx = e[0] - s[0], dy = e[1] - s[1];
  const startH: Heading = sh ?? (Math.abs(dx) >= Math.abs(dy) ? [Math.sign(dx) || 1, 0] : [0, Math.sign(dy) || 1]);
  const endH: Heading = eh ?? (startH[0] !== 0 ? (Math.abs(dy) > 1 && Math.abs(dx) < PAD ? [0, -Math.sign(dy)] : [-startH[0], 0]) : (Math.abs(dx) > 1 && Math.abs(dy) < PAD ? [-Math.sign(dx), 0] : [0, -startH[1]]));
  const a: Point = sh ? [s[0] + startH[0] * PAD, s[1] + startH[1] * PAD] : s;
  const b: Point = eh ? [e[0] + endH[0] * PAD, e[1] + endH[1] * PAD] : e;
  const pts: Point[] = [s, a];
  const startHorizontal = startH[0] !== 0;
  const endHorizontal = endH[0] !== 0;
  if (startHorizontal && endHorizontal) {
    const midX = (a[0] + b[0]) / 2;
    pts.push([midX, a[1]], [midX, b[1]]);
  } else if (!startHorizontal && !endHorizontal) {
    const midY = (a[1] + b[1]) / 2;
    pts.push([a[0], midY], [b[0], midY]);
  } else if (startHorizontal) {
    pts.push([b[0], a[1]]);
  } else {
    pts.push([a[0], b[1]]);
  }
  pts.push(b, e);
  return simplifyOrthogonal(pts);
}

function simplifyOrthogonal(pts: Point[]): Point[] {
  const dedup = pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 0.5);
  const out: Point[] = [];
  for (const p of dedup) {
    if (out.length >= 2) {
      const a = out[out.length - 2], b = out[out.length - 1];
      const collinear = (Math.abs(a[0] - b[0]) < 0.5 && Math.abs(b[0] - p[0]) < 0.5) || (Math.abs(a[1] - b[1]) < 0.5 && Math.abs(b[1] - p[1]) < 0.5);
      if (collinear) out.pop();
    }
    out.push(p);
  }
  return out;
}

/** Store absolute points into a linear element (x,y = first point, angle reset). */
export function withAbsolutePoints(el: LinearElement, abs: Point[]): LinearElement {
  const [x, y] = abs[0];
  const points = abs.map(([px, py]) => [px - x, py - y] as Point);
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  return bump(el, {
    x, y, angle: 0, points,
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  });
}

/** Recompute the bound endpoints of an arrow. */
export function updateArrowBindings(arrow: LinearElement, byId: Map<string, ExcalidrawElement>): LinearElement {
  const start = arrow.startBinding && byId.get(arrow.startBinding.elementId);
  const end = arrow.endBinding && byId.get(arrow.endBinding.elementId);
  const validStart = start && !start.isDeleted ? start : null;
  const validEnd = end && !end.isDeleted ? end : null;
  if (!validStart && !validEnd) {
    if (arrow.startBinding || arrow.endBinding) return bump(arrow, { startBinding: null, endBinding: null });
    return arrow;
  }
  const abs: Point[] = arrow.points.map(([px, py]) => [arrow.x + px, arrow.y + py]);
  if (arrow.angle) {
    const c = getElementCenter(arrow);
    for (let i = 0; i < abs.length; i++) abs[i] = rotatePoint(abs[i], c, arrow.angle);
  }
  const n = abs.length;

  if (arrow.arrowType === "elbow") {
    const sRef = validEnd ? getElementCenter(validEnd) : abs[n - 1];
    const eRef = validStart ? getElementCenter(validStart) : abs[0];
    const s = validStart ? getBindingPoint(validStart, arrow.startBinding!, sRef) : { point: abs[0], heading: null };
    const e = validEnd ? getBindingPoint(validEnd, arrow.endBinding!, eRef) : { point: abs[n - 1], heading: null };
    return withAbsolutePoints(arrow, routeElbow(s.point, s.heading, e.point, e.heading));
  }

  // aim each bound end at the neighbouring point (or the other shape's centre for 2-point arrows)
  const next = [...abs];
  if (validStart) {
    const ref = n > 2 ? abs[1] : validEnd ? getElementCenter(validEnd) : abs[n - 1];
    next[0] = getBindingPoint(validStart, arrow.startBinding!, ref).point;
  }
  if (validEnd) {
    const ref = n > 2 ? abs[n - 2] : validStart ? getElementCenter(validStart) : next[0];
    next[n - 1] = getBindingPoint(validEnd, arrow.endBinding!, ref).point;
  }
  return withAbsolutePoints({ ...arrow, startBinding: validStart ? arrow.startBinding : null, endBinding: validEnd ? arrow.endBinding : null }, next);
}

/**
 * After elements were moved/resized/converted (ids in `changedIds`), re-route bound arrows
 * and re-layout bound text labels. Returns the new full element array (does not touch the store).
 */
export function updateBoundElements(elements: ExcalidrawElement[], changedIds: Iterable<string>): ExcalidrawElement[] {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const arrows = new Set<string>();
  const labels = new Set<string>(); // container ids whose label must be re-laid out
  for (const id of changedIds) {
    const el = byId.get(id);
    if (!el) continue;
    if (isLinear(el) && (el.startBinding || el.endBinding)) arrows.add(el.id);
    for (const b of el.boundElements) {
      if (b.type === "arrow") arrows.add(b.id);
      else labels.add(el.id);
    }
    if (el.type === "text" && (el as TextElement).containerId) labels.add((el as TextElement).containerId!);
  }
  if (!arrows.size && !labels.size) return elements;
  for (const id of arrows) {
    const a = byId.get(id);
    if (a && isLinear(a) && !a.isDeleted) {
      const updated = updateArrowBindings(a, byId);
      byId.set(id, updated);
      if (a.boundElements.some((b) => b.type === "text")) labels.add(id);
    }
  }
  for (const cid of labels) layoutLabel(cid, byId);
  return elements.map((e) => byId.get(e.id) ?? e);
}

/** Re-measure / re-wrap a container's text label and grow the container if needed. */
export function refreshTextLayout(elements: ExcalidrawElement[], textOrContainerId: string): ExcalidrawElement[] {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const el = byId.get(textOrContainerId);
  if (!el) return elements;
  if (el.type === "text" && !(el as TextElement).containerId) {
    const t = el as TextElement;
    const m = measureText(t.text, t.fontSize, t.fontFamily, t.lineHeight);
    if (t.autoResize || m.width > t.width) {
      byId.set(t.id, bump(t, { width: m.width, height: m.height }));
    } else {
      const wrapped = wrapText(t.originalText, t.fontSize, t.fontFamily, t.width);
      const h = measureText(wrapped, t.fontSize, t.fontFamily, t.lineHeight).height;
      byId.set(t.id, bump(t, { text: wrapped, height: h }));
    }
  } else {
    const containerId = el.type === "text" ? (el as TextElement).containerId! : el.id;
    layoutLabel(containerId, byId);
    // labels may resize the container: keep its arrows attached
    return updateBoundElements(elements.map((e) => byId.get(e.id) ?? e), [containerId]);
  }
  return elements.map((e) => byId.get(e.id) ?? e);
}

export const getBoundText = (container: ExcalidrawElement, byId: Map<string, ExcalidrawElement> | ExcalidrawElement[]) => {
  const entry = container.boundElements.find((b) => b.type === "text");
  if (!entry) return undefined;
  const t = Array.isArray(byId) ? byId.find((e) => e.id === entry.id) : byId.get(entry.id);
  return t && !t.isDeleted ? (t as TextElement) : undefined;
};

const ARROW_LABEL_MAX_WIDTH = 260;

/** Position (and wrap) the text label of a container or arrow. Mutates the map. */
function layoutLabel(containerId: string, byId: Map<string, ExcalidrawElement>) {
  const container = byId.get(containerId);
  if (!container || container.isDeleted) return;
  const text = getBoundText(container, byId);
  if (!text) return;

  if (isLinear(container)) {
    const wrapped = wrapText(text.originalText, text.fontSize, text.fontFamily, ARROW_LABEL_MAX_WIDTH);
    const m = measureText(wrapped, text.fontSize, text.fontFamily, text.lineHeight);
    const mid = pointAlongPolyline(getLinearPolyline(container), 0.5);
    byId.set(text.id, bump(text, { text: wrapped, width: m.width, height: m.height, x: mid[0] - m.width / 2, y: mid[1] - m.height / 2, angle: 0 }));
    return;
  }

  let c = container;
  let box = getContainerTextBox(c.type, c.width, c.height);
  const wrapped = wrapText(text.originalText, text.fontSize, text.fontFamily, box.w);
  const m = measureText(wrapped, text.fontSize, text.fontFamily, text.lineHeight);
  // grow the container so the text fits (never shrink automatically)
  const grow = getContainerGrowFactor(c.type);
  const neededH = (m.height + 16) * grow.y;
  const minW = (Math.min(m.width, 40) + 16) * grow.x;
  if (neededH > c.height + 0.5 || minW > c.width + 0.5) {
    const height = Math.max(c.height, neededH);
    const width = Math.max(c.width, minW);
    c = bump(c, { height, width, y: c.y - (height - c.height) / 2 });
    byId.set(c.id, c);
    box = getContainerTextBox(c.type, c.width, c.height);
  }
  const top = text.verticalAlign === "top" ? box.y : text.verticalAlign === "bottom" ? box.y + box.h - m.height : box.y + (box.h - m.height) / 2;
  const localCenter: Point = [c.x + box.x + box.w / 2, c.y + top + m.height / 2];
  const center = rotatePoint(localCenter, getElementCenter(c), c.angle);
  byId.set(
    text.id,
    bump(text, { text: wrapped, width: box.w, height: m.height, x: center[0] - box.w / 2, y: center[1] - m.height / 2, angle: c.angle }),
  );
}
