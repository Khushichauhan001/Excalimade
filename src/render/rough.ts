// Generates (and caches) rough.js drawables for elements in element-local coordinates.
import rough from "roughjs/bin/rough";
import type { Drawable, Options } from "roughjs/bin/core";
import type { Arrowhead, ExcalidrawElement, LinearElement, Point } from "../core/types";
import { getCylinderCap, getShapePath, isShape } from "./shapes";

const generator = rough.generator();

export const isTransparent = (c: string) => !c || c === "transparent" || /^#[0-9a-f]{6}00$/i.test(c) || /^#[0-9a-f]{3}0$/i.test(c);

function baseOptions(el: ExcalidrawElement, w = el.width, h = el.height): Options {
  // shrink roughness for small shapes so they don't look like scribbles
  const minSide = Math.min(Math.abs(w), Math.abs(h));
  const roughness = minSide < 10 && el.type !== "line" && el.type !== "arrow" ? el.roughness / 3 : minSide < 40 ? el.roughness * 0.7 : el.roughness;
  const o: Options = {
    seed: el.seed,
    roughness,
    bowing: 1,
    stroke: isTransparent(el.strokeColor) ? "none" : el.strokeColor,
    strokeWidth: el.strokeWidth,
    fillWeight: el.strokeWidth / 2,
    hachureGap: el.strokeWidth * 4,
    preserveVertices: el.roughness < 2,
    disableMultiStroke: el.strokeStyle !== "solid",
    curveFitting: 0.95,
  };
  if (el.strokeStyle === "dashed") o.strokeLineDash = [8, 8 + el.strokeWidth];
  else if (el.strokeStyle === "dotted") o.strokeLineDash = [1.5, 6 + el.strokeWidth];
  if (el.strokeStyle !== "solid") o.strokeWidth = el.strokeWidth + 0.5;
  return o;
}

const withFill = (el: ExcalidrawElement, o: Options): Options =>
  isTransparent(el.backgroundColor)
    ? o
    : { ...o, fill: el.backgroundColor, fillStyle: el.fillStyle === "cross-hatch" ? "cross-hatch" : el.fillStyle };

export interface ElementDrawables {
  shapes: Drawable[];
}

const cache = new Map<string, { key: unknown[]; value: ElementDrawables }>();

/** Shape-relevant props: if none changed (e.g. only x/y moved), the cached drawables are reused. */
const cacheKey = (el: ExcalidrawElement, extra: unknown) => {
  const e = el as any;
  return [
    el.type, el.width, el.height, el.strokeColor, el.backgroundColor, el.fillStyle, el.strokeWidth, el.strokeStyle,
    el.roughness, el.roundness, el.seed, e.points, e.startArrowhead, e.endArrowhead, e.arrowType, e.polygon, extra,
  ];
};

export function getDrawables(el: ExcalidrawElement, canvasBg = "#ffffff"): ElementDrawables {
  const key = cacheKey(el, canvasBg);
  const hit = cache.get(el.id);
  if (hit && hit.key.length === key.length && hit.key.every((v, i) => v === key[i])) return hit.value;
  const value = { shapes: generate(el, canvasBg) };
  cache.set(el.id, { key, value });
  if (cache.size > 5000) cache.delete(cache.keys().next().value!);
  return value;
}

function generate(el: ExcalidrawElement, canvasBg: string): Drawable[] {
  const w = el.width, h = el.height;
  if (isShape(el)) {
    const o = withFill(el, baseOptions(el));
    if (el.type === "ellipse") return [generator.ellipse(w / 2, h / 2, w, h, o)];
    const out = [generator.path(getShapePath(el.type, w, h, el.roundness === "round")!, o)];
    if (el.type === "cylinder") {
      const cap = getCylinderCap(w, h);
      out.push(generator.ellipse(cap.cx, cap.cy, cap.w, cap.h, { ...o, seed: el.seed + 1 }));
    }
    return out;
  }
  if (el.type === "frame" || el.type === "embeddable") {
    return [generator.rectangle(0, 0, w, h, { ...baseOptions(el), roughness: 0, fill: undefined })];
  }
  if (el.type === "arrow" || el.type === "line") return generateLinear(el as LinearElement, canvasBg);
  return [];
}

/** Points to draw for a linear element (relative coordinates). */
export const getLinearPoints = (el: LinearElement): Point[] => el.points;

const isCurved = (el: LinearElement) =>
  el.points.length > 2 && (el.type === "arrow" ? el.arrowType === "round" : el.roundness === "round");

function generateLinear(el: LinearElement, canvasBg: string): Drawable[] {
  const o = baseOptions(el, 100, 100);
  const pts = el.points;
  const out: Drawable[] = [];
  if (pts.length < 2) return out;
  if (el.type === "line" && el.polygon) {
    out.push(generator.polygon(pts as [number, number][], withFill(el, o)));
  } else if (isCurved(el)) {
    out.push(generator.curve(pts as [number, number][], o));
  } else {
    out.push(generator.linearPath(pts as [number, number][], o));
  }
  if (el.type === "arrow") {
    const headOpts: Options = { ...o, strokeLineDash: undefined, disableMultiStroke: true };
    if (el.startArrowhead) out.push(...arrowheadDrawables(el, "start", el.startArrowhead, headOpts, canvasBg));
    if (el.endArrowhead) out.push(...arrowheadDrawables(el, "end", el.endArrowhead, headOpts, canvasBg));
  }
  return out;
}

/** Tip point and the unit direction pointing *into* the tip. */
function arrowEnd(el: LinearElement, end: "start" | "end") {
  const pts = el.points;
  const tip = end === "end" ? pts[pts.length - 1] : pts[0];
  // for curves, look a short distance back along the path for a stable direction
  let from = end === "end" ? pts[pts.length - 2] : pts[1];
  if (isCurved(el)) {
    const prev = from;
    from = [tip[0] + (prev[0] - tip[0]) * 0.25, tip[1] + (prev[1] - tip[1]) * 0.25];
    if (Math.hypot(from[0] - tip[0], from[1] - tip[1]) < 4) from = prev;
  }
  const len = Math.hypot(tip[0] - from[0], tip[1] - from[1]) || 1;
  const segLen = Math.hypot(tip[0] - (end === "end" ? pts[pts.length - 2] : pts[1])[0], tip[1] - (end === "end" ? pts[pts.length - 2] : pts[1])[1]);
  return { tip, dir: [(tip[0] - from[0]) / len, (tip[1] - from[1]) / len] as Point, segLen };
}

const ARROWHEAD_SIZE: Record<Exclude<Arrowhead, null>, number> = {
  arrow: 25, bar: 15, dot: 15, circle: 15, circle_outline: 15, triangle: 22, triangle_outline: 22,
  diamond: 24, diamond_outline: 24, crowfoot_one: 15, crowfoot_many: 18, crowfoot_one_or_many: 18,
};

/** Arrowhead geometry in relative coords (shared by canvas, SVG export and hit-testing). */
export function getArrowheadGeometry(el: LinearElement, end: "start" | "end", head: Exclude<Arrowhead, null>) {
  const { tip, dir, segLen } = arrowEnd(el, end);
  const size = Math.min(ARROWHEAD_SIZE[head] * (1 + (el.strokeWidth - 2) * 0.12), segLen * (head === "arrow" ? 0.75 : 0.5) + 6);
  const [dx, dy] = dir;
  const nx = -dy, ny = dx; // normal
  const back = (d: number): Point => [tip[0] - dx * d, tip[1] - dy * d];
  return { tip, dir, normal: [nx, ny] as Point, size, back };
}

function arrowheadDrawables(el: LinearElement, end: "start" | "end", head: Exclude<Arrowhead, null>, o: Options, canvasBg: string): Drawable[] {
  const { tip, normal: [nx, ny], size, back } = getArrowheadGeometry(el, end, head);
  const solid: Options = { ...o, fill: o.stroke, fillStyle: "solid" };
  const outline: Options = { ...o, fill: canvasBg, fillStyle: "solid" };
  const side = (p: Point, d: number): [number, number] => [p[0] + nx * d, p[1] + ny * d];
  switch (head) {
    case "arrow": {
      const b = back(size);
      const spread = size * Math.tan((22 * Math.PI) / 180);
      return [generator.linearPath([side(b, spread), tip as [number, number], side(b, -spread)], o)];
    }
    case "bar": {
      return [generator.line(...side(tip, size / 1.6), ...side(tip, -size / 1.6), o)];
    }
    case "dot":
    case "circle":
    case "circle_outline": {
      const c = back(size / 2);
      return [generator.circle(c[0], c[1], size, head === "circle_outline" ? outline : solid)];
    }
    case "triangle":
    case "triangle_outline": {
      const b = back(size);
      const spread = size * 0.55;
      return [generator.polygon([tip as [number, number], side(b, spread), side(b, -spread)], head === "triangle" ? solid : outline)];
    }
    case "diamond":
    case "diamond_outline": {
      const m = back(size / 2), b = back(size);
      const spread = size * 0.32;
      return [generator.polygon([tip as [number, number], side(m, spread), b as [number, number], side(m, -spread)], head === "diamond" ? solid : outline)];
    }
    case "crowfoot_one":
    case "crowfoot_many":
    case "crowfoot_one_or_many": {
      const out: Drawable[] = [];
      if (head !== "crowfoot_one") {
        const b = back(size);
        const spread = size * 0.6;
        out.push(generator.linearPath([side(tip, spread), b as [number, number], side(tip, -spread)], o));
      }
      if (head !== "crowfoot_many") {
        const b = back(head === "crowfoot_one" ? size * 0.6 : size * 1.25);
        out.push(generator.line(...side(b, size * 0.55), ...side(b, -size * 0.55), o));
      }
      return out;
    }
  }
}
