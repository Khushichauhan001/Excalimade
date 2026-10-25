// Mermaid `flowchart` / `graph` parser and converter.
import type { Arrowhead, ExcalidrawElement, ShapeType } from "../../core/types";
import {
  type BuildCtx,
  type NodeStyle,
  type Stmt,
  MermaidError,
  NODE_FONT,
  addLabel,
  cleanLabel,
  makeLinear,
  makeShape,
  measure,
  mergeStyles,
  newGroupId,
  parseStyleDecl,
  styleProps,
  wrapLabel,
} from "./common";
import { type Direction, type GEdge, type GNode, type GraphModel, layoutGraph } from "./graph";

export type FlowShape =
  | "rect"
  | "round"
  | "stadium"
  | "subroutine"
  | "cylinder"
  | "circle"
  | "doublecircle"
  | "asym"
  | "rhombus"
  | "hexagon"
  | "parallelogram"
  | "parallelogram_alt"
  | "trapezoid"
  | "trapezoid_alt";

export interface FlowNode {
  id: string;
  label: string;
  shape: FlowShape;
  classes: string[];
  style: NodeStyle;
  link?: string;
  parent?: string;
  explicit: boolean;
}

export interface FlowEdge {
  from: string;
  to: string;
  label?: string;
  startHead: Arrowhead;
  endHead: Arrowhead;
  stroke: "normal" | "thick" | "dotted" | "invisible";
  length: number;
  style: NodeStyle;
}

export interface FlowSubgraph {
  id: string;
  title: string;
  parent?: string;
}

export interface Flowchart {
  type: "flowchart";
  direction: Direction;
  nodes: Map<string, FlowNode>;
  edges: FlowEdge[];
  subgraphs: FlowSubgraph[];
  classDefs: Map<string, NodeStyle>;
}

const DIRS: Record<string, Direction> = { TB: "TB", TD: "TB", BT: "BT", LR: "LR", RL: "RL", "<": "RL", ">": "LR", v: "TB", "^": "BT" };

// Ordered so longer openers win.
const SHAPES: { open: string; close: string[]; shape: FlowShape | FlowShape[] }[] = [
  { open: "(((", close: [")))"], shape: "doublecircle" },
  { open: "([", close: ["])"], shape: "stadium" },
  { open: "[[", close: ["]]"], shape: "subroutine" },
  { open: "[(", close: [")]"], shape: "cylinder" },
  { open: "((", close: ["))"], shape: "circle" },
  { open: "{{", close: ["}}"], shape: "hexagon" },
  { open: "[/", close: ["/]", "\\]"], shape: ["parallelogram", "trapezoid"] },
  { open: "[\\", close: ["\\]", "/]"], shape: ["parallelogram_alt", "trapezoid_alt"] },
  { open: ">", close: ["]"], shape: "asym" },
  { open: "(", close: [")"], shape: "round" },
  { open: "[", close: ["]"], shape: "rect" },
  { open: "{", close: ["}"], shape: "rhombus" },
];

const AT_SHAPES: Record<string, FlowShape> = {
  rect: "rect", rectangle: "rect", proc: "rect", process: "rect",
  rounded: "round", event: "round",
  stadium: "stadium", pill: "stadium", terminal: "stadium",
  subproc: "subroutine", subroutine: "subroutine", "fr-rect": "subroutine",
  cyl: "cylinder", cylinder: "cylinder", db: "cylinder", database: "cylinder",
  circle: "circle", circ: "circle", "sm-circ": "circle",
  "dbl-circ": "doublecircle", "double-circle": "doublecircle",
  diam: "rhombus", diamond: "rhombus", decision: "rhombus", question: "rhombus",
  hex: "hexagon", hexagon: "hexagon", prepare: "hexagon",
  "lean-r": "parallelogram", "lean-l": "parallelogram_alt",
  "trap-b": "trapezoid", "trap-t": "trapezoid_alt",
  odd: "asym",
};

interface NodeRef {
  id: string;
  shape?: FlowShape;
  label?: string;
  classes: string[];
}

class Scanner {
  s: string;
  i = 0;
  line: number;
  constructor(s: string, line: number) {
    this.s = s;
    this.line = line;
  }
  ws() {
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++;
  }
  eof() {
    return this.i >= this.s.length;
  }
  rest() {
    return this.s.slice(this.i);
  }
  fail(msg?: string): never {
    const near = this.rest().slice(0, 24);
    throw new MermaidError(msg ?? (near ? `Unexpected "${near}"` : "Unexpected end of statement"), this.line);
  }
}

const ID_START = /[\p{L}\p{N}_]/u;
const ID_CHAR = /[\p{L}\p{N}_$]/u;

function readId(sc: Scanner): string | null {
  const { s } = sc;
  let j = sc.i;
  if (j >= s.length || !ID_START.test(s[j])) return null;
  while (j < s.length) {
    if (ID_CHAR.test(s[j])) j++;
    else if ((s[j] === "-" || s[j] === ".") && j + 1 < s.length && ID_CHAR.test(s[j + 1]) && s[j - 1] !== " ") {
      // `a-b` is an id; `a-->b`, `a-.->b` are not (next char is - or .)
      j++;
    } else break;
  }
  const id = s.slice(sc.i, j);
  sc.i = j;
  return id;
}

function readLabel(sc: Scanner, closes: string[]): { text: string; close: string } {
  const { s } = sc;
  let j = sc.i;
  while (j < s.length && s[j] === " ") j++;
  if (s[j] === '"') {
    const end = s.indexOf('"', j + 1);
    if (end < 0) sc.fail("Unterminated string");
    const text = s.slice(j + 1, end);
    let k = end + 1;
    while (k < s.length && s[k] === " ") k++;
    for (const c of closes) {
      if (s.startsWith(c, k)) {
        sc.i = k + c.length;
        return { text, close: c };
      }
    }
    sc.i = k;
    sc.fail(`Expected "${closes[0]}"`);
  }
  let best = -1;
  let bestClose = "";
  for (const c of closes) {
    const k = s.indexOf(c, j);
    if (k >= 0 && (best < 0 || k < best)) {
      best = k;
      bestClose = c;
    }
  }
  if (best < 0) sc.fail(`Missing "${closes[0]}"`);
  sc.i = best + bestClose.length;
  return { text: s.slice(j, best), close: bestClose };
}

function readNodeRef(sc: Scanner): NodeRef | null {
  const id = readId(sc);
  if (!id) return null;
  const ref: NodeRef = { id, classes: [] };
  const s = sc.s;
  if (s.startsWith("@{", sc.i)) {
    const end = s.indexOf("}", sc.i);
    if (end < 0) sc.fail("Missing \"}\"");
    const body = s.slice(sc.i + 2, end);
    sc.i = end + 1;
    const shape = /shape\s*:\s*([\w-]+)/.exec(body)?.[1];
    const label = /label\s*:\s*("([^"]*)"|[^,}]+)/.exec(body);
    ref.shape = (shape && AT_SHAPES[shape]) || "rect";
    if (label) ref.label = cleanLabel(label[2] ?? label[1]);
  } else {
    for (const def of SHAPES) {
      if (!s.startsWith(def.open, sc.i)) continue;
      sc.i += def.open.length;
      const { text, close } = readLabel(sc, def.close);
      ref.shape = Array.isArray(def.shape) ? def.shape[def.close.indexOf(close)] : def.shape;
      ref.label = cleanLabel(text);
      break;
    }
  }
  if (s.startsWith(":::", sc.i)) {
    sc.i += 3;
    const m = /^[\w-]+/.exec(sc.rest());
    if (!m) sc.fail("Expected class name after :::");
    ref.classes.push(m[0]);
    sc.i += m[0].length;
  }
  return ref;
}

interface EdgeTok {
  startHead: Arrowhead;
  endHead: Arrowhead;
  stroke: FlowEdge["stroke"];
  length: number;
  label?: string;
}

const HEAD: Record<string, Arrowhead> = { ">": "arrow", "<": "arrow", o: "circle", x: "bar" };

const PLAIN_EDGE = /^([<ox]?)(-{2,}|={2,}|-\.+-|~{3,})([>ox]?)/;
const TEXT_EDGE = /^([<ox]?)(--|==|-\.)\s*(.+?)\s*(-{2,}[>ox]|-{3,}|={2,}[>ox]|={3,}|\.+-[>ox]?)(?=[\s\p{L}\p{N}_|"]|$)/u;

function readEdge(sc: Scanner): EdgeTok | null {
  const rest = sc.rest();
  let m = PLAIN_EDGE.exec(rest);
  let tok: EdgeTok | null = null;
  if (m) {
    const [all, sm, body, em] = m;
    const valid = body[0] === "~" || body.includes(".") || em || body.length >= 3;
    if (valid && !(sm && !em && body.length < 3)) {
      const kind = body[0] === "~" ? "invisible" : body[0] === "=" ? "thick" : body.includes(".") ? "dotted" : "normal";
      const count = kind === "dotted" ? body.length - 2 : body.length - (em ? 1 : 2);
      tok = {
        startHead: sm ? HEAD[sm] : null,
        endHead: em ? HEAD[em] : null,
        stroke: kind,
        length: Math.max(1, count),
      };
      sc.i += all.length;
    }
  }
  if (!tok) {
    m = TEXT_EDGE.exec(rest);
    if (!m) return null;
    const [all, sm, open, text, close] = m;
    const em = /[>ox]$/.test(close) ? close[close.length - 1] : "";
    const kind = open === "==" ? "thick" : open === "-." ? "dotted" : "normal";
    tok = {
      startHead: sm ? HEAD[sm] : null,
      endHead: em ? HEAD[em] : null,
      stroke: kind,
      length: Math.max(1, close.replace(/[>ox]$/, "").length - (kind === "dotted" ? 1 : em ? 1 : 2)),
      label: cleanLabel(text),
    };
    sc.i += all.length;
  }
  sc.ws();
  if (sc.s[sc.i] === "|") {
    const end = sc.s.indexOf("|", sc.i + 1);
    if (end < 0) sc.fail("Missing closing \"|\"");
    tok.label = cleanLabel(sc.s.slice(sc.i + 1, end));
    sc.i = end + 1;
  }
  return tok;
}

export function parseFlowchart(stmts: Stmt[]): Flowchart {
  const header = stmts[0];
  const hm = /^(flowchart|graph|flowchart-elk)\s*([A-Za-z<>^]{0,2})?\s*;?\s*$/i.exec(header.text);
  if (!hm) throw new MermaidError(`Invalid flowchart header "${header.text}"`, header.line);
  const dirKey = (hm[2] ?? "").toUpperCase() === "V" ? "v" : (hm[2] ?? "TB").toUpperCase();
  const fc: Flowchart = {
    type: "flowchart",
    direction: DIRS[dirKey] ?? DIRS[hm[2] ?? ""] ?? "TB",
    nodes: new Map(),
    edges: [],
    subgraphs: [],
    classDefs: new Map(),
  };
  const stack: FlowSubgraph[] = [];
  const linkStyles: { idx: number[] | "default"; style: NodeStyle }[] = [];
  const styles: { id: string; style: NodeStyle }[] = [];
  const classAssign: { ids: string[]; cls: string }[] = [];
  let anon = 0;

  const touch = (ref: NodeRef) => {
    let n = fc.nodes.get(ref.id);
    if (!n) {
      n = { id: ref.id, label: ref.id, shape: "rect", classes: [], style: {}, explicit: false };
      fc.nodes.set(ref.id, n);
    }
    if (ref.shape) {
      n.shape = ref.shape;
      n.explicit = true;
    }
    if (ref.label != null) n.label = ref.label;
    n.classes.push(...ref.classes);
    const cur = stack[stack.length - 1];
    if (cur && !n.parent && cur.id !== n.id) n.parent = cur.id;
    return n;
  };

  for (let k = 1; k < stmts.length; k++) {
    const { text, line } = stmts[k];
    let m: RegExpExecArray | null;
    if ((m = /^subgraph\b\s*(.*)$/.exec(text))) {
      const rest = m[1].trim();
      let id: string;
      let title: string;
      let mm: RegExpExecArray | null;
      if ((mm = /^([^\s[\]"]+)\s*\[(.*)\]$/.exec(rest))) {
        id = mm[1];
        title = cleanLabel(mm[2]);
      } else if (/^".*"$/.test(rest)) {
        title = cleanLabel(rest);
        id = `subgraph_${++anon}`;
      } else if (rest) {
        id = rest;
        title = cleanLabel(rest);
      } else {
        id = `subgraph_${++anon}`;
        title = "";
      }
      const sg: FlowSubgraph = { id, title, parent: stack[stack.length - 1]?.id };
      fc.subgraphs.push(sg);
      stack.push(sg);
      continue;
    }
    if (text === "end") {
      if (!stack.length) throw new MermaidError('"end" without a matching "subgraph"', line);
      stack.pop();
      continue;
    }
    if (/^direction\s+\w+$/.test(text)) continue;
    if ((m = /^classDef\s+([\w,\s-]+?)\s+(.+)$/.exec(text))) {
      const st = parseStyleDecl(m[2]);
      for (const name of m[1].split(",")) fc.classDefs.set(name.trim(), mergeStyles(fc.classDefs.get(name.trim()), st));
      continue;
    }
    if ((m = /^class\s+([^\s]+(?:\s*,\s*[^\s,]+)*)\s+([\w-]+)$/.exec(text))) {
      classAssign.push({ ids: m[1].split(",").map((s) => s.trim()), cls: m[2] });
      continue;
    }
    if ((m = /^style\s+(\S+)\s+(.+)$/.exec(text))) {
      styles.push({ id: m[1], style: parseStyleDecl(m[2]) });
      continue;
    }
    if ((m = /^linkStyle\s+([\d,\s]+|default)\s+(.+)$/.exec(text))) {
      linkStyles.push({
        idx: m[1].trim() === "default" ? "default" : m[1].split(",").map((s) => parseInt(s, 10)),
        style: parseStyleDecl(m[2]),
      });
      continue;
    }
    if ((m = /^click\s+(\S+)\s+(?:href\s+)?"([^"]+)"/.exec(text))) {
      const n = fc.nodes.get(m[1]);
      if (n && /^(https?:|mailto:|#)/i.test(m[2])) n.link = m[2];
      continue;
    }
    if (/^(click|accTitle|accDescr|interpolate)\b/.test(text)) continue;

    // node / edge chain
    const sc = new Scanner(text, line);
    let prev: FlowNode[] | null = null;
    let pending: EdgeTok | null = null;
    for (;;) {
      sc.ws();
      const group: FlowNode[] = [];
      for (;;) {
        const ref = readNodeRef(sc);
        if (!ref) sc.fail(prev ? "Expected a node after the link" : undefined);
        group.push(touch(ref!));
        sc.ws();
        if (sc.s[sc.i] === "&") {
          sc.i++;
          sc.ws();
          continue;
        }
        break;
      }
      if (prev && pending) {
        for (const a of prev)
          for (const b of group)
            fc.edges.push({
              from: a.id,
              to: b.id,
              label: pending.label || undefined,
              startHead: pending.startHead,
              endHead: pending.endHead,
              stroke: pending.stroke,
              length: pending.length,
              style: {},
            });
      }
      sc.ws();
      if (sc.eof()) break;
      if (sc.s[sc.i] === ";") break;
      const edge = readEdge(sc);
      if (!edge) sc.fail();
      pending = edge;
      prev = group;
    }
  }
  if (stack.length) throw new MermaidError(`Subgraph "${stack[stack.length - 1].title || stack[stack.length - 1].id}" is missing "end"`, stmts[stmts.length - 1].line);

  // implicit nodes that are actually subgraph ids
  const sgIds = new Set(fc.subgraphs.map((s) => s.id));
  for (const id of sgIds) {
    const n = fc.nodes.get(id);
    if (n && !n.explicit) fc.nodes.delete(id);
  }
  // subgraph ids referenced as members of other subgraphs: `subgraph a ... b ... end` where b is a subgraph
  for (const ca of classAssign)
    for (const id of ca.ids) fc.nodes.get(id)?.classes.push(ca.cls);
  for (const s of styles) {
    const n = fc.nodes.get(s.id);
    if (n) n.style = mergeStyles(n.style, s.style);
  }
  for (const ls of linkStyles) {
    if (ls.idx === "default") fc.edges.forEach((e) => (e.style = mergeStyles(ls.style, e.style)));
    else for (const i of ls.idx) if (fc.edges[i]) fc.edges[i].style = mergeStyles(fc.edges[i].style, ls.style);
  }
  return fc;
}

// ---------------------------------------------------------------------------------------------

const SHAPE_TYPE: Record<FlowShape, ShapeType> = {
  rect: "rectangle",
  round: "rectangle",
  stadium: "rectangle",
  subroutine: "rectangle",
  cylinder: "cylinder",
  circle: "ellipse",
  doublecircle: "ellipse",
  asym: "rectangle",
  rhombus: "diamond",
  hexagon: "hexagon",
  parallelogram: "rectangle",
  parallelogram_alt: "rectangle",
  trapezoid: "rectangle",
  trapezoid_alt: "rectangle",
};

export function flowchartToModel(fc: Flowchart, ctx: BuildCtx): GraphModel {
  const defaultStyle = fc.classDefs.get("default");
  const nodes: GNode[] = [];
  for (const n of fc.nodes.values()) {
    const style = mergeStyles(defaultStyle, ...n.classes.map((c) => fc.classDefs.get(c)), n.style);
    const label = wrapLabel(ctx, n.label, NODE_FONT, 220);
    const m = measure(ctx, label, NODE_FONT);
    let w = m.width + 50;
    let h = m.height + 30;
    switch (n.shape) {
      case "rhombus":
        w = m.width * 1.6 + 50;
        h = m.height * 1.6 + 40;
        break;
      case "circle":
      case "doublecircle":
        w = h = Math.max(m.width, m.height) * 1.25 + 40 + (n.shape === "doublecircle" ? 12 : 0);
        break;
      case "hexagon":
        w = m.width + m.height + 60;
        break;
      case "cylinder":
        h = m.height + 60;
        break;
      case "subroutine":
        w += 20;
        break;
    }
    w = Math.max(Math.round(w), n.shape === "circle" || n.shape === "doublecircle" ? 0 : 110);
    h = Math.max(Math.round(h), 56);
    const type = SHAPE_TYPE[n.shape];
    nodes.push({
      id: n.id,
      width: w,
      height: h,
      parent: n.parent,
      clip: type === "ellipse" ? "ellipse" : type === "diamond" ? "diamond" : "rect",
      render: (x, y) => {
        const extra: ExcalidrawElement[] = [];
        const groupIds = n.shape === "subroutine" || n.shape === "doublecircle" ? [newGroupId()] : [];
        const shape = makeShape(ctx, type, x, y, w, h, {
          roundness: n.shape === "rect" || n.shape === "asym" || n.shape.startsWith("para") || n.shape.startsWith("trap") || n.shape === "subroutine" ? "sharp" : "round",
          link: n.link ?? null,
          groupIds,
          ...styleProps(style),
        });
        if (n.shape === "subroutine") {
          for (const lx of [x + 10, x + w - 10])
            extra.push(
              makeLinear(ctx, "line", [[lx, y], [lx, y + h]], {
                color: shape.strokeColor,
                strokeWidth: shape.strokeWidth,
                props: { groupIds },
              }),
            );
        }
        if (n.shape === "doublecircle") {
          extra.push(makeShape(ctx, "ellipse", x + 6, y + 6, w - 12, h - 12, { groupIds, strokeColor: shape.strokeColor, strokeWidth: shape.strokeWidth }));
        }
        const text = addLabel(ctx, shape, label, NODE_FONT, style.color);
        return { elements: [shape, ...extra, text], target: shape };
      },
    });
  }
  const edges: GEdge[] = fc.edges.map((e) => ({
    from: e.from,
    to: e.to,
    label: e.label,
    minlen: e.length,
    startHead: e.startHead,
    endHead: e.endHead,
    strokeStyle: e.stroke === "dotted" || e.style.dashed ? "dashed" : "solid",
    strokeWidth: e.style.strokeWidth ?? (e.stroke === "thick" ? 4 : 2),
    color: e.style.stroke,
    labelColor: e.style.color,
    invisible: e.stroke === "invisible",
  }));
  return {
    direction: fc.direction,
    nodes,
    edges,
    clusters: fc.subgraphs.map((s) => ({ id: s.id, title: s.title, parent: s.parent })),
  };
}

export const flowchartToElements = (fc: Flowchart, ctx: BuildCtx) => layoutGraph(flowchartToModel(fc, ctx), ctx);

