// Shared helpers for the Mermaid → Excalidraw converters: errors, statement splitting,
// style parsing, text measurement and element factories with deterministic diagram styling.
import type {
  Arrowhead,
  ArrowType,
  ExcalidrawElement,
  LinearElement,
  Point,
  ShapeElement,
  ShapeType,
  StrokeStyle,
  TextAlign,
  TextElement,
} from "../../core/types";
import { newLinear, newShape, linearSize, bindTextToContainer } from "../../core/elements";
import { measureText as coreMeasureText } from "../../core/text";
import { getState } from "../../core/store";
import { randomId } from "../../core/utils";

export class MermaidError extends Error {
  line: number;
  constructor(message: string, line: number) {
    super(message);
    this.line = line;
  }
}

export type Measure = (text: string, fontSize: number, fontFamily: number) => { width: number; height: number };

export type ArrowStyle = "round" | "sharp" | "elbow";

export interface BuildOptions {
  /** Text measurement (defaults to the canvas-based `measureText`; inject one in tests). */
  measure?: Measure;
  fontFamily?: number;
  roughness?: number;
  arrowStyle?: ArrowStyle;
}

export interface BuildCtx {
  measure: Measure;
  fontFamily: number;
  roughness: number;
  arrowStyle: ArrowStyle;
}

export const LINE_HEIGHT = 1.25;
export const NODE_FONT = 20;
export const EDGE_FONT = 16;
export const SMALL_FONT = 16;
export const STROKE = "#1e1e1e";
export const MUTED_STROKE = "#868e96";

export function makeCtx(opts: BuildOptions = {}): BuildCtx {
  const as = getState().appState;
  return {
    measure: opts.measure ?? ((t, s, f) => coreMeasureText(t, s, f, LINE_HEIGHT)),
    fontFamily: opts.fontFamily ?? as.currentItemFontFamily,
    roughness: opts.roughness ?? as.currentItemRoughness,
    arrowStyle: opts.arrowStyle ?? "round",
  };
}

// ---------------------------------------------------------------------------------------------
// Source preprocessing

export interface Stmt {
  text: string;
  line: number; // 1-based
}

/** Strip YAML front matter / init directives / comments; return trimmed non-empty lines. */
export function toStatements(src: string, splitSemicolons = false): { stmts: Stmt[]; title?: string } {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const stmts: Stmt[] = [];
  let title: string | undefined;
  let i = 0;
  // front matter
  while (i < lines.length && !lines[i].trim()) i++;
  if (lines[i]?.trim() === "---") {
    let j = i + 1;
    while (j < lines.length && lines[j].trim() !== "---") {
      const m = /^\s*title\s*:\s*(.+)$/.exec(lines[j]);
      if (m) title = unquote(m[1].trim());
      j++;
    }
    i = j + 1;
  }
  for (; i < lines.length; i++) {
    let raw = lines[i];
    const t = raw.trim();
    if (!t || t.startsWith("%%")) continue;
    raw = cutComment(raw);
    const parts = splitSemicolons ? splitOutsideQuotes(raw, ";") : [raw];
    for (const p of parts) {
      const s = p.trim();
      if (s) stmts.push({ text: s, line: i + 1 });
    }
  }
  return { stmts, title };
}

function cutComment(line: string) {
  let q = false;
  for (let i = 0; i < line.length - 1; i++) {
    if (line[i] === '"') q = !q;
    else if (!q && line[i] === "%" && line[i + 1] === "%") return line.slice(0, i);
  }
  return line;
}

export function splitOutsideQuotes(s: string, sep: string): string[] {
  const out: string[] = [];
  let q = false;
  let cur = "";
  for (const ch of s) {
    if (ch === '"') q = !q;
    if (ch === sep && !q) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export const unquote = (s: string) => {
  const t = s.trim();
  if (t.length >= 2 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'")))) return t.slice(1, -1);
  return t;
};

const ENTITIES: Record<string, string> = { quot: '"', amp: "&", lt: "<", gt: ">", nbsp: " ", apos: "'" };

/** Normalise a Mermaid label: quotes, markdown backticks, <br>, entities, inline HTML tags. */
export function cleanLabel(s: string): string {
  let t = unquote(s);
  if (t.startsWith("`") && t.endsWith("`") && t.length >= 2) t = t.slice(1, -1);
  t = t
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/\\n/g, "\n")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/#([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(^|\s)_(.+?)_(\s|$)/g, "$1$2$3");
  return t
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .trim();
}

// ---------------------------------------------------------------------------------------------
// Styles (classDef / style / linkStyle)

export interface NodeStyle {
  fill?: string;
  stroke?: string;
  color?: string;
  strokeWidth?: number;
  dashed?: boolean;
}

const COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|[a-z]+)$/i;

export function parseStyleDecl(decl: string): NodeStyle {
  const st: NodeStyle = {};
  for (const part of decl.split(/[,;](?![^(]*\))/)) {
    const idx = part.indexOf(":");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim().toLowerCase();
    const v = part.slice(idx + 1).trim().replace(/\s*!important$/, "");
    if (!v) continue;
    if (k === "fill" || k === "background" || k === "background-color") {
      if (COLOR_RE.test(v)) st.fill = v;
    } else if (k === "stroke" || k === "border-color") {
      if (COLOR_RE.test(v)) st.stroke = v;
    } else if (k === "color") {
      if (COLOR_RE.test(v)) st.color = v;
    } else if (k === "stroke-width") {
      const n = parseFloat(v);
      if (!Number.isNaN(n)) st.strokeWidth = n <= 1 ? 1 : n <= 2.5 ? 2 : 4;
    } else if (k === "stroke-dasharray") {
      st.dashed = v !== "0" && v !== "none";
    }
  }
  return st;
}

export const mergeStyles = (...styles: (NodeStyle | undefined)[]): NodeStyle => Object.assign({}, ...styles.filter(Boolean));

export function styleProps(st: NodeStyle | undefined) {
  const p: Partial<ExcalidrawElement> = {};
  if (!st) return p;
  if (st.fill && st.fill !== "none") {
    p.backgroundColor = st.fill;
    p.fillStyle = "solid";
  }
  if (st.stroke && st.stroke !== "none") p.strokeColor = st.stroke;
  if (st.strokeWidth) p.strokeWidth = st.strokeWidth;
  if (st.dashed) p.strokeStyle = "dashed";
  return p;
}

// ---------------------------------------------------------------------------------------------
// Text

/** Greedy word wrap using the injected measure function. */
export function wrapLabel(ctx: BuildCtx, text: string, fontSize: number, maxWidth: number): string {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = "";
    for (const w of words) {
      const cand = line ? `${line} ${w}` : w;
      if (!line || ctx.measure(cand, fontSize, ctx.fontFamily).width <= maxWidth) line = cand;
      else {
        out.push(line);
        line = w;
      }
    }
    out.push(line);
  }
  return out.join("\n");
}

export const measure = (ctx: BuildCtx, text: string, fontSize: number) => {
  const m = ctx.measure(text || " ", fontSize, ctx.fontFamily);
  const lines = (text || " ").split("\n").length;
  return { width: Math.ceil(m.width), height: Math.ceil(Math.max(m.height, lines * fontSize * LINE_HEIGHT)) };
};

/** Common diagram styling (deterministic, independent of the current item style except font/roughness). */
export const baseStyle = (ctx: BuildCtx): Partial<ExcalidrawElement> => ({
  strokeColor: STROKE,
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 2,
  strokeStyle: "solid",
  roughness: ctx.roughness,
  opacity: 100,
});

export function makeText(
  ctx: BuildCtx,
  text: string,
  opts: {
    x?: number;
    y?: number;
    /** centre point instead of top-left */
    cx?: number;
    cy?: number;
    fontSize?: number;
    align?: TextAlign;
    color?: string;
    props?: Partial<TextElement>;
  } = {},
): TextElement {
  const fontSize = opts.fontSize ?? NODE_FONT;
  const m = measure(ctx, text, fontSize);
  const x = opts.cx != null ? opts.cx - m.width / 2 : (opts.x ?? 0);
  const y = opts.cy != null ? opts.cy - m.height / 2 : (opts.y ?? 0);
  const base = newShape("rectangle", { ...baseStyle(ctx) }) as unknown as Record<string, unknown>;
  return {
    ...base,
    type: "text",
    x,
    y,
    width: m.width,
    height: m.height,
    strokeColor: opts.color ?? STROKE,
    backgroundColor: "transparent",
    roundness: "sharp",
    text,
    originalText: text,
    fontSize,
    fontFamily: ctx.fontFamily,
    textAlign: opts.align ?? "center",
    verticalAlign: "middle",
    lineHeight: LINE_HEIGHT,
    containerId: null,
    autoResize: true,
    ...opts.props,
  } as TextElement;
}

export function makeShape(
  ctx: BuildCtx,
  type: ShapeType,
  x: number,
  y: number,
  width: number,
  height: number,
  props: Partial<ExcalidrawElement> = {},
): ShapeElement {
  return newShape(type, {
    ...baseStyle(ctx),
    roundness: type === "rectangle" ? "sharp" : "round",
    x,
    y,
    width,
    height,
    ...props,
  });
}

/** Create a label text centred inside `container` and bind it. */
export function addLabel(
  ctx: BuildCtx,
  container: ExcalidrawElement,
  text: string,
  fontSize = NODE_FONT,
  color?: string,
): TextElement {
  const t = makeText(ctx, text, {
    cx: container.x + container.width / 2,
    cy: container.y + container.height / 2,
    fontSize,
    color,
    props: { groupIds: [...container.groupIds], frameId: container.frameId },
  });
  bindTextToContainer(container, t);
  return t;
}

export function makeLinear(
  ctx: BuildCtx,
  type: "arrow" | "line",
  absPoints: Point[],
  opts: {
    startHead?: Arrowhead;
    endHead?: Arrowhead;
    arrowType?: ArrowType;
    strokeStyle?: StrokeStyle;
    strokeWidth?: number;
    color?: string;
    props?: Partial<LinearElement>;
  } = {},
): LinearElement {
  const [x0, y0] = absPoints[0];
  const points = absPoints.map(([x, y]) => [round2(x - x0), round2(y - y0)] as Point);
  const el = newLinear(type, {
    ...baseStyle(ctx),
    x: round2(x0),
    y: round2(y0),
    points,
    startArrowhead: opts.startHead ?? null,
    endArrowhead: opts.endHead ?? null,
    arrowType: opts.arrowType ?? "sharp",
    strokeStyle: opts.strokeStyle ?? "solid",
    strokeWidth: opts.strokeWidth ?? 2,
    strokeColor: opts.color ?? STROKE,
    roundness: opts.arrowType === "round" ? "round" : "sharp",
    ...opts.props,
  });
  return { ...el, ...linearSize(el.points) };
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

export const newGroupId = () => randomId();

/** Translate all elements so the diagram's top-left corner sits at (0, 0). */
export function normalizePosition(elements: ExcalidrawElement[]): ExcalidrawElement[] {
  if (!elements.length) return elements;
  let minX = Infinity;
  let minY = Infinity;
  for (const e of elements) {
    if (e.type === "arrow" || e.type === "line") {
      for (const [px, py] of (e as LinearElement).points) {
        minX = Math.min(minX, e.x + px);
        minY = Math.min(minY, e.y + py);
      }
    } else {
      minX = Math.min(minX, e.x);
      minY = Math.min(minY, e.y - (e.type === "frame" ? 24 : 0));
    }
  }
  return elements.map((e) => ({ ...e, x: round2(e.x - minX), y: round2(e.y - minY) }));
}

/** Excalidraw palette (light backgrounds + matching strokes) used for charts / pie slices. */
export const PALETTE = [
  { bg: "#a5d8ff", stroke: "#1971c2" },
  { bg: "#ffc9c9", stroke: "#e03131" },
  { bg: "#b2f2bb", stroke: "#2f9e44" },
  { bg: "#ffec99", stroke: "#f08c00" },
  { bg: "#d0bfff", stroke: "#6741d9" },
  { bg: "#99e9f2", stroke: "#0c8599" },
  { bg: "#ffd8a8", stroke: "#e8590c" },
  { bg: "#eebefa", stroke: "#9c36b5" },
  { bg: "#c0eb75", stroke: "#5c940d" },
  { bg: "#fcc2d7", stroke: "#c2255c" },
];
