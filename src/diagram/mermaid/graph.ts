// Generic graph layout (dagre) + element construction shared by flowchart, class, ER and state diagrams.
import dagre from "@dagrejs/dagre";
import type { Arrowhead, ExcalidrawElement, LinearElement, Point, StrokeStyle } from "../../core/types";
import { bindArrow, bindTextToContainer, newFrame } from "../../core/elements";
import { type BuildCtx, EDGE_FONT, SMALL_FONT, makeLinear, makeText, measure, wrapLabel } from "./common";

export type Direction = "TB" | "BT" | "LR" | "RL";
export type ClipShape = "rect" | "ellipse" | "diamond";

export interface RenderedNode {
  /** All elements of the node in z-order. */
  elements: ExcalidrawElement[];
  /** Element arrows bind to. */
  target: ExcalidrawElement;
}

export interface GNode {
  id: string;
  width: number;
  height: number;
  /** Id of the innermost cluster containing the node. */
  parent?: string;
  clip: ClipShape;
  /** Build the node's elements with its top-left corner at (x, y). */
  render: (x: number, y: number) => RenderedNode;
}

export interface GEdge {
  from: string;
  to: string;
  label?: string;
  minlen?: number;
  startHead: Arrowhead;
  endHead: Arrowhead;
  strokeStyle: StrokeStyle;
  strokeWidth: number;
  color?: string;
  labelColor?: string;
  /** Layout-only edge (mermaid `~~~`). */
  invisible?: boolean;
  /** Small labels at the ends (class diagram cardinalities). */
  startLabel?: string;
  endLabel?: string;
}

export interface GCluster {
  id: string;
  title: string;
  parent?: string;
}

export interface GraphModel {
  direction: Direction;
  nodes: GNode[];
  edges: GEdge[];
  clusters: GCluster[];
  nodesep?: number;
  ranksep?: number;
}

const GAP = 4;

export function layoutGraph(model: GraphModel, ctx: BuildCtx): ExcalidrawElement[] {
  const g = new dagre.graphlib.Graph({ compound: true, multigraph: true });
  g.setGraph({
    rankdir: model.direction,
    nodesep: model.nodesep ?? 50,
    ranksep: model.ranksep ?? 70,
    edgesep: 25,
    marginx: 20,
    marginy: 20,
  });
  g.setDefaultEdgeLabel(() => ({}));

  const nodeById = new Map(model.nodes.map((n) => [n.id, n]));
  const clusterById = new Map(model.clusters.map((c) => [c.id, c]));

  // clusters with no descendant nodes would break dagre — keep only populated ones
  const populated = new Set<string>();
  for (const n of model.nodes) {
    let p = n.parent;
    while (p && clusterById.has(p) && !populated.has(p)) {
      populated.add(p);
      p = clusterById.get(p)!.parent;
    }
  }
  const clusters = model.clusters.filter((c) => populated.has(c.id));
  const validParent = (p?: string) => {
    while (p && !populated.has(p)) p = clusterById.get(p)?.parent;
    return p;
  };

  // edges may point at clusters (mermaid `A --> subgraphId`): route to a representative node
  const representative = (id: string): string | undefined => {
    if (nodeById.has(id)) return id;
    if (!populated.has(id)) return undefined;
    const direct = model.nodes.find((n) => validParent(n.parent) === id);
    if (direct) return direct.id;
    const child = clusters.find((c) => validParent(c.parent) === id);
    return child ? representative(child.id) : undefined;
  };

  for (const c of clusters) g.setNode(c.id, { width: 0, height: 0 });
  for (const c of clusters) {
    const p = validParent(c.parent);
    if (p) g.setParent(c.id, p);
  }
  for (const n of model.nodes) {
    g.setNode(n.id, { width: n.width, height: n.height });
    const p = validParent(n.parent);
    if (p) g.setParent(n.id, p);
  }

  interface EdgeInfo {
    e: GEdge;
    v: string;
    w: string;
    name: string;
    label?: string;
    lw: number;
    lh: number;
  }
  const infos: EdgeInfo[] = [];
  model.edges.forEach((e, i) => {
    const v = representative(e.from);
    const w = representative(e.to);
    if (!v || !w) return;
    const label = e.label ? wrapLabel(ctx, e.label, EDGE_FONT, 200) : undefined;
    const m = label ? measure(ctx, label, EDGE_FONT) : { width: 0, height: 0 };
    const info: EdgeInfo = { e, v, w, name: `e${i}`, label, lw: m.width, lh: m.height };
    infos.push(info);
    g.setEdge(
      v,
      w,
      { width: label ? m.width + 10 : 0, height: label ? m.height + 6 : 0, labelpos: "c", minlen: e.minlen ?? 1 },
      info.name,
    );
  });

  dagre.layout(g);

  const out: ExcalidrawElement[] = [];
  const frames = new Map<string, ExcalidrawElement>();

  // frames, outermost first
  const depth = (id: string) => {
    let d = 0;
    let p = validParent(clusterById.get(id)?.parent);
    while (p) {
      d++;
      p = validParent(clusterById.get(p)?.parent);
    }
    return d;
  };
  for (const c of [...clusters].sort((a, b) => depth(a.id) - depth(b.id))) {
    const gn = g.node(c.id);
    if (!gn || gn.x == null || gn.y == null) continue;
    const pad = 6;
    const frame = newFrame({
      name: c.title,
      x: gn.x - gn.width / 2 - pad,
      y: gn.y - gn.height / 2 - pad,
      width: gn.width + pad * 2,
      height: gn.height + pad * 2,
    });
    const p = validParent(c.parent);
    if (p && frames.has(p)) frame.frameId = frames.get(p)!.id;
    frames.set(c.id, frame);
    out.push(frame);
  }

  const targets = new Map<string, { el: ExcalidrawElement; node: GNode; cx: number; cy: number }>();
  for (const n of model.nodes) {
    const gn = g.node(n.id);
    const x = gn.x! - n.width / 2;
    const y = gn.y! - n.height / 2;
    const r = n.render(x, y);
    const p = validParent(n.parent);
    const frameId = p ? (frames.get(p)?.id ?? null) : null;
    for (const el of r.elements) el.frameId = frameId;
    out.push(...r.elements);
    targets.set(n.id, { el: r.target, node: n, cx: gn.x!, cy: gn.y! });
  }

  for (const info of infos) {
    const { e } = info;
    if (e.invisible) continue;
    const ge = g.edge({ v: info.v, w: info.w, name: info.name });
    const src = targets.get(info.v)!;
    const dst = targets.get(info.w)!;
    let pts: Point[] = (ge.points ?? []).map((p: { x: number; y: number }) => [p.x, p.y] as Point);
    if (pts.length < 2) pts = [[src.cx, src.cy], [dst.cx, dst.cy]];

    if (info.v !== info.w) {
      pts[0] = clipToShape(src, pts[1]);
      pts[pts.length - 1] = clipToShape(dst, pts[pts.length - 2]);
    }

    let arrowType: "round" | "sharp" | "elbow" = ctx.arrowStyle;
    if (ctx.arrowStyle === "elbow" && info.v !== info.w) pts = orthogonal(pts, model.direction);
    else if (ctx.arrowStyle === "sharp") pts = simplify(pts);
    if (pts.length === 2 && arrowType === "round") arrowType = "sharp";

    const arrow = makeLinear(ctx, "arrow", pts, {
      startHead: e.startHead,
      endHead: e.endHead,
      arrowType,
      strokeStyle: e.strokeStyle,
      strokeWidth: e.strokeWidth,
      color: e.color,
    });
    bindArrow(arrow, "start", src.el);
    bindArrow(arrow, "end", dst.el);
    // frame membership: both ends inside the same frame
    const fs = src.el.frameId;
    if (fs && fs === dst.el.frameId) arrow.frameId = fs;
    out.push(arrow);

    if (info.label) {
      const lx = ge.x ?? (pts[0][0] + pts[pts.length - 1][0]) / 2;
      const ly = ge.y ?? (pts[0][1] + pts[pts.length - 1][1]) / 2;
      const t = makeText(ctx, info.label, { cx: lx, cy: ly, fontSize: EDGE_FONT, color: e.labelColor });
      t.frameId = arrow.frameId;
      bindTextToContainer(arrow as LinearElement, t);
      out.push(t);
    }
    if (e.startLabel) out.push(endLabel(ctx, pts[0], pts[1], e.startLabel, arrow.frameId));
    if (e.endLabel) out.push(endLabel(ctx, pts[pts.length - 1], pts[pts.length - 2], e.endLabel, arrow.frameId));
  }
  return out;
}

function endLabel(ctx: BuildCtx, end: Point, next: Point, text: string, frameId: string | null) {
  const dx = next[0] - end[0];
  const dy = next[1] - end[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  // a little along the edge and off to its side
  const m = measure(ctx, text, SMALL_FONT);
  const cx = end[0] + ux * (14 + m.width / 2) + -uy * (m.width / 2 + 6);
  const cy = end[1] + uy * (14 + m.height / 2) + ux * (m.height / 2 + 2);
  const t = makeText(ctx, text, { cx, cy, fontSize: SMALL_FONT });
  t.frameId = frameId;
  return t;
}

/** Point where the ray from the node centre towards `toward` leaves the node outline, plus the binding gap. */
function clipToShape(t: { node: GNode; cx: number; cy: number }, toward: Point): Point {
  const { node, cx, cy } = t;
  let dx = toward[0] - cx;
  let dy = toward[1] - cy;
  if (dx === 0 && dy === 0) dy = 1;
  const hw = node.width / 2;
  const hh = node.height / 2;
  let s: number; // scale so (dx,dy)*s is on the outline
  if (node.clip === "ellipse") s = 1 / Math.sqrt((dx * dx) / (hw * hw) + (dy * dy) / (hh * hh));
  else if (node.clip === "diamond") s = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
  else s = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
  const len = Math.hypot(dx, dy);
  dx /= len;
  dy /= len;
  const r = s * len + GAP;
  return [cx + dx * r, cy + dy * r];
}

/** Orthogonal 2–4 point route between the clipped endpoints following the rank direction. */
function orthogonal(pts: Point[], dir: Direction): Point[] {
  const a = pts[0];
  const b = pts[pts.length - 1];
  const vertical = dir === "TB" || dir === "BT";
  if (vertical) {
    if (Math.abs(a[0] - b[0]) < 1) return [a, [a[0], b[1]]];
    const my = (a[1] + b[1]) / 2;
    return [a, [a[0], my], [b[0], my], b];
  }
  if (Math.abs(a[1] - b[1]) < 1) return [a, [b[0], a[1]]];
  const mx = (a[0] + b[0]) / 2;
  return [a, [mx, a[1]], [mx, b[1]], b];
}

/** Drop nearly collinear intermediate points (keeps sharp polylines clean). */
function simplify(pts: Point[]): Point[] {
  if (pts.length <= 2) return pts;
  const out: Point[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1];
    const b = pts[i];
    const c = pts[i + 1];
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(cross) > 40) out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
}
