// Mermaid `erDiagram` parser and converter (entities as tables, crow's-foot relations).
import type { Arrowhead, ExcalidrawElement } from "../../core/types";
import { type BuildCtx, type Stmt, MermaidError, cleanLabel } from "./common";
import { compartmentBox } from "./classDiagram";
import { type Direction, type GEdge, type GNode, layoutGraph } from "./graph";

export interface ErAttribute {
  type: string;
  name: string;
  keys: string[];
  comment?: string;
}
export interface ErEntity {
  id: string;
  label: string;
  attributes: ErAttribute[];
}
export interface ErRelation {
  from: string;
  to: string;
  fromCard: string;
  toCard: string;
  identifying: boolean;
  label: string;
}
export interface ErDiagram {
  type: "er";
  direction: Direction;
  entities: Map<string, ErEntity>;
  relations: ErRelation[];
}

const CARD: Record<string, Arrowhead> = {
  "|o": "crowfoot_one",
  "o|": "crowfoot_one",
  "||": "crowfoot_one",
  "}o": "crowfoot_many",
  "o{": "crowfoot_many",
  "}|": "crowfoot_one_or_many",
  "|{": "crowfoot_one_or_many",
};
const WORDS: Record<string, string> = {
  "zero or one": "|o",
  "one or zero": "|o",
  "exactly one": "||",
  "only one": "||",
  "one or more": "}|",
  "one or many": "}|",
  "many(1)": "}|",
  "1+": "}|",
  "zero or more": "}o",
  "zero or many": "}o",
  "many(0)": "}o",
  "0+": "}o",
};
const ENT = `("[^"]+"|[\\p{L}\\p{N}_-]+)`;
const REL_RE = new RegExp(`^${ENT}\\s*(\\|o|\\|\\||\\}o|\\}\\|)(--|\\.\\.)(o\\||\\|\\||o\\{|\\|\\{)\\s*${ENT}\\s*:\\s*(.+)$`, "u");
const WORD_REL_RE = new RegExp(
  `^${ENT}\\s+(zero or one|one or zero|exactly one|only one|one or more|one or many|many\\(1\\)|1\\+|zero or more|zero or many|many\\(0\\)|0\\+)\\s+(to|optionally to)\\s+(zero or one|one or zero|exactly one|only one|one or more|one or many|many\\(1\\)|1\\+|zero or more|zero or many|many\\(0\\)|0\\+)\\s+${ENT}\\s*:\\s*(.+)$`,
  "iu",
);
const mirror = (l: string) => ({ "|o": "o|", "||": "||", "}o": "o{", "}|": "|{" })[l] ?? l;

export function parseErDiagram(stmts: Stmt[]): ErDiagram {
  const d: ErDiagram = { type: "er", direction: "TB", entities: new Map(), relations: [] };
  const ensure = (raw: string) => {
    const id = cleanLabel(raw);
    let e = d.entities.get(id);
    if (!e) {
      e = { id, label: id, attributes: [] };
      d.entities.set(id, e);
    }
    return e;
  };
  let body: ErEntity | null = null;
  for (let k = 1; k < stmts.length; k++) {
    const { text, line } = stmts[k];
    if (body) {
      if (text === "}") {
        body = null;
        continue;
      }
      const m = /^([\w(),.[\]-]+)\s+([\w*-]+)\s*((?:PK|FK|UK)(?:\s*,\s*(?:PK|FK|UK))*)?\s*(?:"(.*)")?$/.exec(text);
      if (!m) throw new MermaidError(`Invalid attribute "${text}" (expected: type name [PK|FK|UK] ["comment"])`, line);
      body.attributes.push({
        type: m[1],
        name: m[2],
        keys: m[3] ? m[3].split(",").map((s) => s.trim()) : [],
        comment: m[4],
      });
      continue;
    }
    let m: RegExpExecArray | null;
    if ((m = /^direction\s+(TB|TD|BT|LR|RL)$/i.exec(text))) {
      const v = m[1].toUpperCase();
      d.direction = (v === "TD" ? "TB" : v) as Direction;
      continue;
    }
    if (/^(accTitle|accDescr|classDef|class|style)\b/.test(text)) continue;
    if ((m = new RegExp(`^${ENT}\\s*(?:\\[\\s*"?([^"\\]]*)"?\\s*\\])?\\s*\\{\\s*(\\})?$`, "u").exec(text))) {
      const e = ensure(m[1]);
      if (m[2]) e.label = m[2];
      if (!m[3]) body = e;
      continue;
    }
    if ((m = REL_RE.exec(text))) {
      const [, a, l, ln, r, b, label] = m;
      ensure(a);
      ensure(b);
      d.relations.push({ from: cleanLabel(a), to: cleanLabel(b), fromCard: l, toCard: r, identifying: ln === "--", label: cleanLabel(label) });
      continue;
    }
    if ((m = WORD_REL_RE.exec(text))) {
      const [, a, l, conn, r, b, label] = m;
      ensure(a);
      ensure(b);
      d.relations.push({
        from: cleanLabel(a),
        to: cleanLabel(b),
        fromCard: WORDS[l.toLowerCase()],
        toCard: mirror(WORDS[r.toLowerCase()]),
        identifying: conn.toLowerCase() === "to",
        label: cleanLabel(label),
      });
      continue;
    }
    if ((m = new RegExp(`^${ENT}(?:\\s*\\[\\s*"?([^"\\]]*)"?\\s*\\])?$`, "u").exec(text))) {
      const e = ensure(m[1]);
      if (m[2]) e.label = m[2];
      continue;
    }
    throw new MermaidError(`Unrecognised statement "${text.slice(0, 40)}"`, line);
  }
  if (body) throw new MermaidError(`Entity "${(body as ErEntity).id}" is missing "}"`, stmts[stmts.length - 1].line);
  if (!d.entities.size) throw new MermaidError("No entities defined", stmts[0].line);
  return d;
}

export function erDiagramToElements(d: ErDiagram, ctx: BuildCtx): ExcalidrawElement[] {
  const nodes: GNode[] = [];
  for (const e of d.entities.values()) {
    const rows = e.attributes.map((a) => [a.type, a.name, a.keys.join(","), a.comment ? `"${a.comment}"` : ""].filter(Boolean).join("  "));
    const box = compartmentBox(ctx, [e.label], rows.length ? [rows] : [], {}, { headerFill: "#e7f5ff", minWidth: 150 });
    nodes.push({ id: e.id, width: box.width, height: box.height, clip: "rect", render: box.render });
  }
  const edges: GEdge[] = d.relations.map((r) => ({
    from: r.from,
    to: r.to,
    label: r.label,
    startHead: CARD[r.fromCard] ?? null,
    endHead: CARD[r.toCard] ?? null,
    strokeStyle: r.identifying ? "solid" : "dashed",
    strokeWidth: 2,
  }));
  return layoutGraph({ direction: d.direction, nodes, edges, clusters: [], ranksep: 90, nodesep: 60 }, ctx);
}
