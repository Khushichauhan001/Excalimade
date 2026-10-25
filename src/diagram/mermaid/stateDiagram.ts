// Mermaid `stateDiagram` / `stateDiagram-v2` parser and converter.
import type { ExcalidrawElement } from "../../core/types";
import {
  type BuildCtx,
  type NodeStyle,
  type Stmt,
  MermaidError,
  NODE_FONT,
  SMALL_FONT,
  STROKE,
  addLabel,
  cleanLabel,
  makeShape,
  measure,
  mergeStyles,
  newGroupId,
  parseStyleDecl,
  styleProps,
  wrapLabel,
} from "./common";
import { type Direction, type GEdge, type GNode, layoutGraph } from "./graph";

type StateKind = "state" | "start" | "end" | "fork" | "join" | "choice" | "note";

export interface StateNode {
  id: string;
  label: string;
  descriptions: string[];
  kind: StateKind;
  parent?: string;
  classes: string[];
  style: NodeStyle;
}

export interface StateDiagram {
  type: "state";
  direction: Direction;
  states: Map<string, StateNode>;
  composites: { id: string; title: string; parent?: string }[];
  transitions: { from: string; to: string; label?: string; note?: boolean }[];
  classDefs: Map<string, NodeStyle>;
}

const SID = String.raw`(\[\*\]|[\p{L}\p{N}_.-]+(?::::[\w-]+)?)`;
const TRANS_RE = new RegExp(String.raw`^${SID}\s*-->\s*${SID}\s*(?::\s*(.*))?$`, "u");

export function parseStateDiagram(stmts: Stmt[]): StateDiagram {
  const d: StateDiagram = { type: "state", direction: "TB", states: new Map(), composites: [], transitions: [], classDefs: new Map() };
  const stack: string[] = [];
  let noteCount = 0;
  let pendingNote: { node: StateNode; lines: string[] } | null = null;

  const scope = () => stack[stack.length - 1];
  const ensure = (raw: string, side: "from" | "to" | "decl"): StateNode => {
    let id = raw;
    const classes: string[] = [];
    const cm = /^(.*?):::([\w-]+)$/.exec(raw);
    if (cm) {
      id = cm[1];
      classes.push(cm[2]);
    }
    let kind: StateKind = "state";
    if (id === "[*]") {
      kind = side === "to" ? "end" : "start";
      id = `__${kind}__${scope() ?? "root"}`;
    }
    let s = d.states.get(id);
    if (!s) {
      s = { id, label: kind === "state" ? id : "", descriptions: [], kind, parent: scope(), classes: [], style: {} };
      d.states.set(id, s);
    }
    s.classes.push(...classes);
    return s;
  };

  for (let k = 1; k < stmts.length; k++) {
    const { text, line } = stmts[k];
    if (pendingNote) {
      if (/^end\s*note$/i.test(text)) {
        pendingNote.node.label = pendingNote.lines.join("\n");
        pendingNote = null;
      } else pendingNote.lines.push(cleanLabel(text));
      continue;
    }
    let m: RegExpExecArray | null;
    if ((m = /^direction\s+(TB|TD|BT|LR|RL)$/i.exec(text))) {
      const v = m[1].toUpperCase();
      if (!stack.length) d.direction = (v === "TD" ? "TB" : v) as Direction;
      continue;
    }
    if (/^(hide empty description|scale\b|accTitle|accDescr|--$)/i.test(text)) continue;
    if (text === "}") {
      if (!stack.length) throw new MermaidError('Unexpected "}"', line);
      stack.pop();
      continue;
    }
    if ((m = /^state\s+"([^"]*)"\s+as\s+([\p{L}\p{N}_.-]+)\s*(\{)?$/u.exec(text))) {
      const s = ensure(m[2], "decl");
      s.label = cleanLabel(m[1]);
      if (m[3]) {
        d.composites.push({ id: s.id, title: s.label, parent: scope() });
        d.states.delete(s.id);
        stack.push(s.id);
      }
      continue;
    }
    if ((m = /^state\s+([\p{L}\p{N}_.-]+)\s*(<<(fork|join|choice)>>)?\s*(\{)?$/u.exec(text))) {
      if (m[4]) {
        d.composites.push({ id: m[1], title: m[1], parent: scope() });
        stack.push(m[1]);
      } else {
        const s = ensure(m[1], "decl");
        if (m[3]) s.kind = m[3] as StateKind;
      }
      continue;
    }
    if ((m = /^note\s+(left of|right of)\s+([\p{L}\p{N}_.-]+)\s*(?::\s*(.*))?$/iu.exec(text))) {
      const target = ensure(m[2], "decl");
      const node: StateNode = {
        id: `__note_${++noteCount}`,
        label: m[3] ? cleanLabel(m[3]) : "",
        descriptions: [],
        kind: "note",
        parent: target.parent,
        classes: [],
        style: {},
      };
      d.states.set(node.id, node);
      const left = m[1].toLowerCase().startsWith("left");
      d.transitions.push(left ? { from: node.id, to: target.id, note: true } : { from: target.id, to: node.id, note: true });
      if (!m[3]) pendingNote = { node, lines: [] };
      continue;
    }
    if ((m = /^classDef\s+([\w,\s-]+?)\s+(.+)$/.exec(text))) {
      const st = parseStyleDecl(m[2]);
      for (const n of m[1].split(",")) d.classDefs.set(n.trim(), st);
      continue;
    }
    if ((m = /^class\s+([^\s]+(?:\s*,\s*[^\s,]+)*)\s+([\w-]+)$/.exec(text))) {
      for (const id of m[1].split(",")) d.states.get(id.trim())?.classes.push(m[2]);
      continue;
    }
    if ((m = /^style\s+(\S+)\s+(.+)$/.exec(text))) {
      const s = d.states.get(m[1]);
      if (s) s.style = mergeStyles(s.style, parseStyleDecl(m[2]));
      continue;
    }
    if ((m = TRANS_RE.exec(text))) {
      const a = ensure(m[1], "from");
      const b = ensure(m[2], "to");
      d.transitions.push({ from: a.id, to: b.id, label: m[3] ? cleanLabel(m[3]) : undefined });
      continue;
    }
    if ((m = /^([\p{L}\p{N}_.-]+)\s*:\s*(.+)$/u.exec(text))) {
      ensure(m[1], "decl").descriptions.push(cleanLabel(m[2]));
      continue;
    }
    if ((m = /^([\p{L}\p{N}_.-]+(?::::[\w-]+)?)$/u.exec(text))) {
      ensure(m[1], "decl");
      continue;
    }
    throw new MermaidError(`Unrecognised statement "${text.slice(0, 40)}"`, line);
  }
  if (stack.length) throw new MermaidError(`State "${stack[stack.length - 1]}" is missing "}"`, stmts[stmts.length - 1].line);
  // composite ids referenced as plain states (transitions into composites) become cluster edges
  for (const c of d.composites) {
    const s = d.states.get(c.id);
    if (s && s.kind === "state") d.states.delete(c.id);
  }
  if (!d.states.size) throw new MermaidError("No states defined", stmts[0].line);
  return d;
}

export function stateDiagramToElements(d: StateDiagram, ctx: BuildCtx): ExcalidrawElement[] {
  const horizontal = d.direction === "LR" || d.direction === "RL";
  const nodes: GNode[] = [];
  for (const s of d.states.values()) {
    const style = mergeStyles(d.classDefs.get("default"), ...s.classes.map((c) => d.classDefs.get(c)), s.style);
    const base = { id: s.id, parent: s.parent };
    switch (s.kind) {
      case "start":
        nodes.push({
          ...base, width: 26, height: 26, clip: "ellipse",
          render: (x, y) => {
            const el = makeShape(ctx, "ellipse", x, y, 26, 26, { backgroundColor: STROKE, fillStyle: "solid" });
            return { elements: [el], target: el };
          },
        });
        break;
      case "end":
        nodes.push({
          ...base, width: 30, height: 30, clip: "ellipse",
          render: (x, y) => {
            const gid = newGroupId();
            const outer = makeShape(ctx, "ellipse", x, y, 30, 30, { groupIds: [gid] });
            const inner = makeShape(ctx, "ellipse", x + 7, y + 7, 16, 16, { backgroundColor: STROKE, fillStyle: "solid", groupIds: [gid] });
            return { elements: [outer, inner], target: outer };
          },
        });
        break;
      case "fork":
      case "join": {
        const w = horizontal ? 10 : 90;
        const h = horizontal ? 90 : 10;
        nodes.push({
          ...base, width: w, height: h, clip: "rect",
          render: (x, y) => {
            const el = makeShape(ctx, "rectangle", x, y, w, h, { backgroundColor: STROKE, fillStyle: "solid", roughness: 0 });
            return { elements: [el], target: el };
          },
        });
        break;
      }
      case "choice":
        nodes.push({
          ...base, width: 40, height: 40, clip: "diamond",
          render: (x, y) => {
            const el = makeShape(ctx, "diamond", x, y, 40, 40, styleProps(style));
            return { elements: [el], target: el };
          },
        });
        break;
      case "note": {
        const label = wrapLabel(ctx, s.label, SMALL_FONT, 220);
        const m = measure(ctx, label, SMALL_FONT);
        const w = m.width + 28;
        const h = m.height + 20;
        nodes.push({
          ...base, width: w, height: h, clip: "rect",
          render: (x, y) => {
            const el = makeShape(ctx, "rectangle", x, y, w, h, { backgroundColor: "#fff3bf", fillStyle: "solid", strokeWidth: 1 });
            return { elements: [el, addLabel(ctx, el, label, SMALL_FONT)], target: el };
          },
        });
        break;
      }
      default: {
        const label = wrapLabel(ctx, [s.label, ...s.descriptions].join("\n"), NODE_FONT, 220);
        const m = measure(ctx, label, NODE_FONT);
        const w = Math.max(100, m.width + 44);
        const h = Math.max(50, m.height + 26);
        nodes.push({
          ...base, width: w, height: h, clip: "rect",
          render: (x, y) => {
            const el = makeShape(ctx, "rectangle", x, y, w, h, { roundness: "round", ...styleProps(style) });
            return { elements: [el, addLabel(ctx, el, label, NODE_FONT, style.color)], target: el };
          },
        });
      }
    }
  }
  const edges: GEdge[] = d.transitions.map((t) => ({
    from: t.from,
    to: t.to,
    label: t.label,
    startHead: null,
    endHead: t.note ? null : "arrow",
    strokeStyle: t.note ? "dashed" : "solid",
    strokeWidth: t.note ? 1 : 2,
    minlen: 1,
  }));
  return layoutGraph(
    { direction: d.direction, nodes, edges, clusters: d.composites.map((c) => ({ id: c.id, title: c.title, parent: c.parent })), ranksep: 60 },
    ctx,
  );
}
