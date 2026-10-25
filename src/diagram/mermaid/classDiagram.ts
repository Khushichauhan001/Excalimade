// Mermaid `classDiagram` parser and converter.
import type { Arrowhead, ExcalidrawElement } from "../../core/types";
import {
  type BuildCtx,
  type NodeStyle,
  type Stmt,
  MermaidError,
  SMALL_FONT,
  cleanLabel,
  makeLinear,
  makeShape,
  makeText,
  measure,
  mergeStyles,
  newGroupId,
  parseStyleDecl,
  styleProps,
} from "./common";
import { type Direction, type GEdge, type GNode, layoutGraph } from "./graph";

export interface ClassDef {
  id: string;
  label: string;
  annotations: string[];
  attributes: string[];
  methods: string[];
  style: NodeStyle;
  classes: string[];
}

export interface ClassRelation {
  from: string;
  to: string;
  fromMarker: string;
  toMarker: string;
  dashed: boolean;
  label?: string;
  fromCard?: string;
  toCard?: string;
}

export interface ClassDiagram {
  type: "class";
  direction: Direction;
  classes: Map<string, ClassDef>;
  relations: ClassRelation[];
  notes: { text: string; for?: string }[];
  classDefs: Map<string, NodeStyle>;
}

const REL_RE =
  /^([\w.$`~-]+)\s*(?:"([^"]*)")?\s*(<\||\*|o|<|\})?(--|\.\.)(\|>|\*|o|>|\{)?\s*(?:"([^"]*)")?\s*([\w.$`~-]+)\s*(?::\s*(.*))?$/;

const MARKER: Record<string, Arrowhead> = {
  "<|": "triangle_outline",
  "|>": "triangle_outline",
  "*": "diamond",
  o: "diamond_outline",
  "<": "arrow",
  ">": "arrow",
};

const generic = (s: string) => s.replace(/~([^~]*)~/g, "<$1>");

export function parseClassDiagram(stmts: Stmt[]): ClassDiagram {
  const d: ClassDiagram = { type: "class", direction: "TB", classes: new Map(), relations: [], notes: [], classDefs: new Map() };
  const ensure = (rawId: string, line: number) => {
    const id = rawId.replace(/~[^~]*~$/, "").replace(/`/g, "");
    if (!id) throw new MermaidError("Missing class name", line);
    let c = d.classes.get(id);
    if (!c) {
      c = { id, label: generic(rawId.replace(/`/g, "")), annotations: [], attributes: [], methods: [], style: {}, classes: [] };
      d.classes.set(id, c);
    } else if (rawId.includes("~")) c.label = generic(rawId);
    return c;
  };
  const addMember = (c: ClassDef, raw: string) => {
    const m = raw.trim();
    if (!m) return;
    const an = /^<<(.+)>>$/.exec(m);
    if (an) c.annotations.push(an[1].trim());
    else if (m.includes("(")) c.methods.push(generic(m));
    else c.attributes.push(generic(m));
  };

  let body: ClassDef | null = null;
  for (let k = 1; k < stmts.length; k++) {
    const { text, line } = stmts[k];
    if (body) {
      if (text === "}") body = null;
      else if (text.endsWith("}")) {
        addMember(body, text.slice(0, -1));
        body = null;
      } else addMember(body, text);
      continue;
    }
    let m: RegExpExecArray | null;
    if ((m = /^direction\s+(TB|TD|BT|LR|RL)$/i.exec(text))) {
      const v = m[1].toUpperCase();
      d.direction = (v === "TD" ? "TB" : v) as Direction;
      continue;
    }
    if (/^(namespace\s+\S+\s*\{|\}|accTitle|accDescr|callback|click|link)/.test(text)) continue;
    if ((m = /^class\s+([\w.$`~-]+)(?:\["([^"]*)"\])?(?::::([\w-]+))?\s*(\{)?\s*(.*?)\s*(\})?$/.exec(text))) {
      const c = ensure(m[1], line);
      if (m[2]) c.label = cleanLabel(m[2]);
      if (m[3]) c.classes.push(m[3]);
      if (m[4]) {
        if (m[5]) addMember(c, m[5]);
        if (!m[6]) body = c;
      }
      continue;
    }
    if ((m = /^<<(.+)>>\s*([\w.$`~-]+)$/.exec(text))) {
      ensure(m[2], line).annotations.push(m[1].trim());
      continue;
    }
    if ((m = /^note\s+(?:for\s+([\w.$-]+)\s+)?"(.*)"$/.exec(text))) {
      d.notes.push({ text: cleanLabel(m[2]), for: m[1] });
      continue;
    }
    if ((m = /^classDef\s+([\w,\s-]+?)\s+(.+)$/.exec(text))) {
      const st = parseStyleDecl(m[2]);
      for (const n of m[1].split(",")) d.classDefs.set(n.trim(), st);
      continue;
    }
    if ((m = /^cssClass\s+"([^"]+)"\s+([\w-]+)$/.exec(text))) {
      for (const id of m[1].split(",")) d.classes.get(id.trim())?.classes.push(m[2]);
      continue;
    }
    if ((m = /^style\s+(\S+)\s+(.+)$/.exec(text))) {
      const c = d.classes.get(m[1]);
      if (c) c.style = mergeStyles(c.style, parseStyleDecl(m[2]));
      continue;
    }
    if ((m = REL_RE.exec(text))) {
      const [, a, card1, lm, line2, rm, card2, b, label] = m;
      ensure(a, line);
      ensure(b, line);
      d.relations.push({
        from: a.replace(/~[^~]*~$/, "").replace(/`/g, ""),
        to: b.replace(/~[^~]*~$/, "").replace(/`/g, ""),
        fromMarker: lm ?? "",
        toMarker: rm ?? "",
        dashed: line2 === "..",
        label: label ? cleanLabel(label) : undefined,
        fromCard: card1,
        toCard: card2,
      });
      continue;
    }
    if ((m = /^([\w.$`~-]+)\s*:\s*(.+)$/.exec(text))) {
      addMember(ensure(m[1], line), m[2]);
      continue;
    }
    if ((m = /^([\w.$`~-]+)$/.exec(text))) {
      ensure(m[1], line);
      continue;
    }
    throw new MermaidError(`Unrecognised statement "${text.slice(0, 40)}"`, line);
  }
  if (body) throw new MermaidError(`Class "${(body as ClassDef).id}" is missing "}"`, stmts[stmts.length - 1].line);
  if (!d.classes.size) throw new MermaidError("No classes defined", stmts[0].line);
  return d;
}

// ---------------------------------------------------------------------------------------------

/** A "table-like" box: header (centred title lines) + sections of left-aligned rows separated by lines. */
export function compartmentBox(
  ctx: BuildCtx,
  header: string[],
  sections: string[][],
  style: NodeStyle,
  opts: { headerFont?: number; rowFont?: number; minWidth?: number; headerFill?: string } = {},
) {
  const hf = opts.headerFont ?? 20;
  const rf = opts.rowFont ?? SMALL_FONT;
  const headerText = header.join("\n");
  const hm = measure(ctx, headerText, hf);
  const secTexts = sections.map((rows) => rows.join("\n"));
  const secM = secTexts.map((t) => (t ? measure(ctx, t, rf) : { width: 0, height: rf * 1.25 }));
  const width = Math.max(opts.minWidth ?? 140, hm.width + 40, ...secM.map((m) => m.width + 30));
  const headerH = hm.height + 20;
  const secH = secM.map((m) => m.height + 16);
  const height = headerH + secH.reduce((a, b) => a + b, 0);
  return {
    width,
    height,
    render: (x: number, y: number) => {
      const gid = newGroupId();
      const g = { groupIds: [gid] };
      const rect = makeShape(ctx, "rectangle", x, y, width, height, { ...g, ...styleProps(style) });
      const els: ExcalidrawElement[] = [rect];
      if (opts.headerFill) {
        els.push(
          makeShape(ctx, "rectangle", x, y, width, headerH, { ...g, backgroundColor: opts.headerFill, fillStyle: "solid", strokeColor: rect.strokeColor, roughness: 0, strokeWidth: 1 }),
        );
      }
      els.push(makeText(ctx, headerText, { cx: x + width / 2, cy: y + headerH / 2, fontSize: hf, color: style.color, props: g }));
      let cy = y + headerH;
      secTexts.forEach((t, i) => {
        els.push(makeLinear(ctx, "line", [[x, cy], [x + width, cy]], { color: rect.strokeColor, strokeWidth: 1, props: g }));
        if (t) els.push(makeText(ctx, t, { x: x + 14, y: cy + 8, fontSize: rf, align: "left", color: style.color, props: g }));
        cy += secH[i];
      });
      return { elements: els, target: rect };
    },
  };
}

export function classDiagramToElements(d: ClassDiagram, ctx: BuildCtx): ExcalidrawElement[] {
  const nodes: GNode[] = [];
  for (const c of d.classes.values()) {
    const style = mergeStyles(d.classDefs.get("default"), ...c.classes.map((n) => d.classDefs.get(n)), c.style);
    const header = [...c.annotations.map((a) => `«${a}»`), c.label];
    const box = compartmentBox(ctx, header, [c.attributes, c.methods], style);
    nodes.push({ id: c.id, width: box.width, height: box.height, clip: "rect", render: box.render });
  }
  const edges: GEdge[] = d.relations.map((r) => ({
    from: r.from,
    to: r.to,
    label: r.label,
    startHead: MARKER[r.fromMarker] ?? null,
    endHead: MARKER[r.toMarker] ?? null,
    strokeStyle: r.dashed ? "dashed" : "solid",
    strokeWidth: 2,
    startLabel: r.fromCard,
    endLabel: r.toCard,
  }));
  d.notes.forEach((n, i) => {
    const id = `__note_${i}`;
    const m = measure(ctx, n.text, SMALL_FONT);
    const w = m.width + 28;
    const h = m.height + 20;
    nodes.push({
      id,
      width: w,
      height: h,
      clip: "rect",
      render: (x, y) => {
        const rect = makeShape(ctx, "rectangle", x, y, w, h, { backgroundColor: "#fff3bf", fillStyle: "solid", strokeWidth: 1 });
        const t = makeText(ctx, n.text, { cx: x + w / 2, cy: y + h / 2, fontSize: SMALL_FONT });
        t.containerId = rect.id;
        rect.boundElements = [{ id: t.id, type: "text" }];
        return { elements: [rect, t], target: rect };
      },
    });
    if (n.for && d.classes.has(n.for))
      edges.push({ from: id, to: n.for, startHead: null, endHead: null, strokeStyle: "dashed", strokeWidth: 1 });
  });
  return layoutGraph({ direction: d.direction, nodes, edges, clusters: [], ranksep: 80 }, ctx);
}
