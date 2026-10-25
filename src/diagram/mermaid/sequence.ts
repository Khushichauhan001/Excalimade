// Mermaid `sequenceDiagram` parser and converter (manual layout, no dagre).
import type { Arrowhead, ExcalidrawElement } from "../../core/types";
import {
  type BuildCtx,
  type Stmt,
  MermaidError,
  MUTED_STROKE,
  SMALL_FONT,
  addLabel,
  cleanLabel,
  makeLinear,
  makeShape,
  makeText,
  measure,
  newGroupId,
  wrapLabel,
} from "./common";

export interface SeqParticipant {
  id: string;
  label: string;
  actor: boolean;
  box?: number;
}

export type SeqItem =
  | {
      kind: "msg";
      from: string;
      to: string;
      text: string;
      dotted: boolean;
      startHead: Arrowhead;
      endHead: Arrowhead;
      activate: boolean;
      deactivate: boolean;
    }
  | { kind: "note"; pos: "left" | "right" | "over"; actors: string[]; text: string }
  | { kind: "activate" | "deactivate"; actor: string }
  | { kind: "start"; block: string; label: string; color?: string }
  | { kind: "section"; label: string }
  | { kind: "end" };

export interface SequenceDiagram {
  type: "sequence";
  title?: string;
  participants: SeqParticipant[];
  boxes: { label: string; color?: string }[];
  items: SeqItem[];
  autonumber: boolean;
}

const ARROWS: Record<string, { dotted: boolean; start: Arrowhead; end: Arrowhead }> = {
  "->": { dotted: false, start: null, end: null },
  "-->": { dotted: true, start: null, end: null },
  "->>": { dotted: false, start: null, end: "arrow" },
  "-->>": { dotted: true, start: null, end: "arrow" },
  "<<->>": { dotted: false, start: "arrow", end: "arrow" },
  "<<-->>": { dotted: true, start: "arrow", end: "arrow" },
  "-x": { dotted: false, start: null, end: "bar" },
  "--x": { dotted: true, start: null, end: "bar" },
  "-)": { dotted: false, start: null, end: "triangle_outline" },
  "--)": { dotted: true, start: null, end: "triangle_outline" },
};

const MSG_RE = /^(.+?)\s*(<<-->>|<<->>|-->>|->>|--x|-x|--\)|-\)|-->|->)\s*([+-]?)\s*(.+?)\s*(?::(.*))?$/;
const BLOCKS = ["loop", "alt", "opt", "par", "critical", "break", "rect"];
const SECTIONS = ["else", "and", "option"];

export function parseSequence(stmts: Stmt[], title?: string): SequenceDiagram {
  const d: SequenceDiagram = { type: "sequence", title, participants: [], boxes: [], items: [], autonumber: false };
  const byId = new Map<string, SeqParticipant>();
  const open: ("block" | "box")[] = [];
  let currentBox: number | undefined;

  const ensure = (id: string, label?: string, actor = false) => {
    let p = byId.get(id);
    if (!p) {
      p = { id, label: label ?? id, actor, box: currentBox };
      byId.set(id, p);
      d.participants.push(p);
    } else {
      if (label) p.label = label;
      if (actor) p.actor = true;
    }
    return p;
  };

  for (let k = 1; k < stmts.length; k++) {
    const { text, line } = stmts[k];
    let m: RegExpExecArray | null;
    if ((m = /^(?:create\s+)?(participant|actor)\s+(.+?)(?:\s+as\s+(.+))?$/i.exec(text))) {
      const id = m[2].replace(/@\{.*\}$/, "").trim();
      ensure(cleanLabel(id), m[3] ? cleanLabel(m[3]) : undefined, m[1].toLowerCase() === "actor");
      continue;
    }
    if (/^destroy\s+/i.test(text) || /^(links?|properties|details|accTitle|accDescr)\b/i.test(text)) continue;
    if (/^autonumber\b/i.test(text)) {
      d.autonumber = !/off$/i.test(text);
      continue;
    }
    if ((m = /^title\s*:?\s*(.+)$/i.exec(text))) {
      d.title = cleanLabel(m[1]);
      continue;
    }
    if ((m = /^(activate|deactivate)\s+(.+)$/i.exec(text))) {
      const actor = m[2].trim();
      ensure(actor);
      d.items.push({ kind: m[1].toLowerCase() as "activate" | "deactivate", actor });
      continue;
    }
    if ((m = /^note\s+(left of|right of|over)\s+([^:]+?)\s*:\s*(.*)$/i.exec(text))) {
      const actors = m[2].split(",").map((s) => s.trim()).filter(Boolean);
      actors.forEach((a) => ensure(a));
      const pos = m[1].toLowerCase().startsWith("left") ? "left" : m[1].toLowerCase().startsWith("right") ? "right" : "over";
      d.items.push({ kind: "note", pos, actors, text: cleanLabel(m[3]) });
      continue;
    }
    if ((m = /^box(?:\s+(.*))?$/i.exec(text))) {
      const rest = (m[1] ?? "").trim();
      const cm = /^(rgba?\([^)]*\)|hsla?\([^)]*\)|#[0-9a-f]{3,8}|transparent|[a-z]+)(?:\s+(.*))?$/i.exec(rest);
      let color: string | undefined;
      let label = rest;
      if (cm && (cm[1].startsWith("rgb") || cm[1].startsWith("hsl") || cm[1].startsWith("#") || isCssColorWord(cm[1]))) {
        color = cm[1].toLowerCase() === "transparent" ? undefined : cm[1];
        label = cm[2] ?? "";
      }
      d.boxes.push({ label: cleanLabel(label), color });
      currentBox = d.boxes.length - 1;
      open.push("box");
      continue;
    }
    if ((m = /^(\w+)\b\s*(.*)$/.exec(text)) && BLOCKS.includes(m[1].toLowerCase())) {
      const block = m[1].toLowerCase();
      open.push("block");
      d.items.push({
        kind: "start",
        block,
        label: block === "rect" ? "" : cleanLabel(m[2]),
        color: block === "rect" ? m[2].trim() || undefined : undefined,
      });
      continue;
    }
    if (m && SECTIONS.includes(m[1].toLowerCase())) {
      if (open[open.length - 1] !== "block") throw new MermaidError(`"${m[1]}" outside of a block`, line);
      d.items.push({ kind: "section", label: cleanLabel(m[2]) });
      continue;
    }
    if (text.toLowerCase() === "end") {
      const kind = open.pop();
      if (!kind) throw new MermaidError('"end" without a matching block', line);
      if (kind === "box") currentBox = undefined;
      else d.items.push({ kind: "end" });
      continue;
    }
    if ((m = MSG_RE.exec(text))) {
      const [, from, arrow, mod, to, msg] = m;
      const a = ARROWS[arrow];
      const f = ensure(from.trim());
      const t = ensure(to.trim());
      d.items.push({
        kind: "msg",
        from: f.id,
        to: t.id,
        text: cleanLabel(msg ?? ""),
        dotted: a.dotted,
        startHead: a.start,
        endHead: a.end,
        activate: mod === "+",
        deactivate: mod === "-",
      });
      continue;
    }
    throw new MermaidError(`Unrecognised statement "${text.slice(0, 40)}"`, line);
  }
  if (open.length) throw new MermaidError('Missing "end"', stmts[stmts.length - 1].line);
  if (!d.participants.length) throw new MermaidError("No participants or messages", stmts[0].line);
  return d;
}

function isCssColorWord(w: string) {
  return /^(aqua|black|blue|fuchsia|gray|grey|green|lime|maroon|navy|olive|orange|purple|red|silver|teal|white|yellow|pink|cyan|magenta|gold|brown|beige|lavender|ivory|khaki|coral|salmon|tan|wheat|azure|aliceblue|lightblue|lightgreen|lightgray|lightgrey|lightyellow|lightpink|transparent)$/i.test(
    w,
  );
}

// ---------------------------------------------------------------------------------------------

const BOX_H = 60;
const PART_FONT = 20;

export function sequenceToElements(d: SequenceDiagram, ctx: BuildCtx): ExcalidrawElement[] {
  const parts = d.participants;
  const idx = new Map(parts.map((p, i) => [p.id, i]));
  const labels = parts.map((p) => wrapLabel(ctx, p.label, PART_FONT, 220));
  const widths = parts.map((p, i) => {
    const m = measure(ctx, labels[i], PART_FONT);
    return p.actor ? Math.max(70, m.width + 10) : Math.max(120, m.width + 40);
  });

  // horizontal spacing
  const gaps = parts.slice(1).map((_, i) => widths[i] / 2 + widths[i + 1] / 2 + 50);
  let leftMargin = 0;
  let rightMargin = 0;
  const need = (lo: number, hi: number, w: number) => {
    if (hi <= lo) return;
    let cur = 0;
    for (let i = lo; i < hi; i++) cur += gaps[i];
    if (cur < w) for (let i = lo; i < hi; i++) gaps[i] += (w - cur) / (hi - lo);
  };
  let n = 0;
  const msgText = new Map<SeqItem, string>();
  for (const it of d.items) {
    if (it.kind === "msg") {
      const text = d.autonumber ? `${++n}. ${it.text}`.trim() : it.text;
      const wrapped = wrapLabel(ctx, text, SMALL_FONT, 320);
      msgText.set(it, wrapped);
      const w = measure(ctx, wrapped, SMALL_FONT).width;
      const a = idx.get(it.from)!;
      const b = idx.get(it.to)!;
      if (a === b) {
        if (a < gaps.length) need(a, a + 1, w + 70);
        else rightMargin = Math.max(rightMargin, w + 70);
      } else need(Math.min(a, b), Math.max(a, b), w + 40);
    } else if (it.kind === "note") {
      const wrapped = wrapLabel(ctx, it.text, SMALL_FONT, 220);
      msgText.set(it, wrapped);
      const w = measure(ctx, wrapped, SMALL_FONT).width + 24;
      const a = idx.get(it.actors[0])!;
      const b = idx.get(it.actors[it.actors.length - 1]) ?? a;
      if (it.pos === "over") need(Math.min(a, b), Math.max(a, b), w - 40);
      else if (it.pos === "right") {
        if (a < gaps.length) need(a, a + 1, w + 30 + widths[a + 1] / 2);
        else rightMargin = Math.max(rightMargin, w + 20);
      } else {
        if (a > 0) need(a - 1, a, w + 30 + widths[a - 1] / 2);
        else leftMargin = Math.max(leftMargin, w + 20);
      }
    }
  }
  const cx: number[] = [];
  let x = Math.max(widths[0] / 2, leftMargin);
  parts.forEach((_, i) => {
    cx.push(x);
    x += gaps[i] ?? 0;
  });
  void rightMargin;

  const layers = { back: [] as ExcalidrawElement[], blocks: [] as ExcalidrawElement[], life: [] as ExcalidrawElement[], act: [] as ExcalidrawElement[], fore: [] as ExcalidrawElement[], parts: [] as ExcalidrawElement[] };

  // vertical walk
  let y = BOX_H + 36;
  const active = new Map<string, number[]>(); // actor -> stack of start y
  const activeDepth = (id: string) => active.get(id)?.length ?? 0;
  const activate = (id: string, at: number) => {
    const s = active.get(id) ?? [];
    s.push(at);
    active.set(id, s);
  };
  const deactivate = (id: string, at: number) => {
    const s = active.get(id);
    const start = s?.pop();
    if (start == null) return;
    const depth = s!.length;
    const i = idx.get(id)!;
    layers.act.push(
      makeShape(ctx, "rectangle", cx[i] - 7 + depth * 6, start, 14, Math.max(at - start, 16), {
        backgroundColor: "#e9ecef",
        fillStyle: "solid",
        strokeWidth: 1,
        roughness: Math.min(ctx.roughness, 1),
      }),
    );
  };
  interface Block {
    item: Extract<SeqItem, { kind: "start" }>;
    y: number;
    minX: number;
    maxX: number;
    sections: { y: number; label: string }[];
    depth: number;
  }
  const blocks: Block[] = [];
  const extend = (x1: number, x2: number) => {
    for (const b of blocks) {
      b.minX = Math.min(b.minX, x1);
      b.maxX = Math.max(b.maxX, x2);
    }
  };
  const edgeX = (id: string, towards: number) => {
    const i = idx.get(id)!;
    const dpt = activeDepth(id);
    if (!dpt) return cx[i];
    const off = (dpt - 1) * 6;
    return towards >= cx[i] ? cx[i] + 7 + off : cx[i] - 7 + off;
  };

  for (const it of d.items) {
    switch (it.kind) {
      case "msg": {
        const text = msgText.get(it) ?? "";
        const th = text ? measure(ctx, text, SMALL_FONT).height : 0;
        const a = idx.get(it.from)!;
        const b = idx.get(it.to)!;
        y += th + 10;
        if (a === b) {
          const x0 = edgeX(it.from, cx[a] + 1);
          const pts: [number, number][] = [[x0, y], [x0 + 46, y], [x0 + 46, y + 32], [x0 + (it.activate ? 6 : 0), y + 32]];
          layers.fore.push(
            makeLinear(ctx, "arrow", pts, { startHead: it.startHead, endHead: it.endHead, strokeStyle: it.dotted ? "dashed" : "solid", strokeWidth: 2 }),
          );
          if (text) {
            const t = makeText(ctx, text, { x: x0 + 10, y: y - th - 4, fontSize: SMALL_FONT, align: "left" });
            layers.fore.push(t);
            extend(x0, x0 + 56 + t.width);
          } else extend(x0, x0 + 56);
          if (it.activate) activate(it.to, y + 32);
          if (it.deactivate) deactivate(it.from, y + 32);
          y += 32;
        } else {
          if (it.activate) activate(it.to, y);
          const x1 = edgeX(it.from, cx[b]);
          const x2 = edgeX(it.to, cx[a]);
          layers.fore.push(
            makeLinear(ctx, "arrow", [[x1, y], [x2, y]], { startHead: it.startHead, endHead: it.endHead, strokeStyle: it.dotted ? "dashed" : "solid", strokeWidth: 2 }),
          );
          if (text) layers.fore.push(makeText(ctx, text, { cx: (x1 + x2) / 2, y: y - th - 4, fontSize: SMALL_FONT }));
          extend(Math.min(x1, x2), Math.max(x1, x2));
          if (it.deactivate) deactivate(it.from, y);
        }
        y += 22;
        break;
      }
      case "note": {
        const text = msgText.get(it) ?? "";
        const m = measure(ctx, text, SMALL_FONT);
        const a = idx.get(it.actors[0])!;
        const b = idx.get(it.actors[it.actors.length - 1]) ?? a;
        const w0 = m.width + 24;
        const h = m.height + 18;
        let x1: number;
        let w = w0;
        if (it.pos === "over") {
          const lo = Math.min(cx[a], cx[b]);
          const hi = Math.max(cx[a], cx[b]);
          w = Math.max(w0, hi - lo + 50);
          x1 = (lo + hi) / 2 - w / 2;
        } else if (it.pos === "right") x1 = cx[a] + 18;
        else x1 = cx[a] - 18 - w0;
        const rect = makeShape(ctx, "rectangle", x1, y, w, h, { backgroundColor: "#fff3bf", fillStyle: "solid", strokeWidth: 1 });
        layers.fore.push(rect, addLabel(ctx, rect, text, SMALL_FONT));
        extend(x1, x1 + w);
        y += h + 16;
        break;
      }
      case "activate":
        activate(it.actor, y);
        break;
      case "deactivate":
        deactivate(it.actor, y);
        break;
      case "start":
        blocks.push({ item: it, y, minX: Infinity, maxX: -Infinity, sections: [], depth: blocks.length });
        y += it.block === "rect" ? 14 : 40;
        break;
      case "section":
        if (blocks.length) blocks[blocks.length - 1].sections.push({ y: y + 2, label: it.label });
        y += 36;
        break;
      case "end": {
        const b = blocks.pop()!;
        if (b.minX === Infinity) {
          b.minX = cx[0] - widths[0] / 2;
          b.maxX = cx[cx.length - 1] + widths[widths.length - 1] / 2;
        }
        const tagW = measure(ctx, b.item.block, SMALL_FONT).width + 20;
        const lblW = b.item.label ? measure(ctx, `[${b.item.label}]`, SMALL_FONT).width + 20 : 0;
        const x1 = b.minX - 24;
        const x2 = Math.max(b.maxX + 24, x1 + tagW + lblW + 20);
        const h = y - b.y + 6;
        if (b.item.block === "rect") {
          layers.back.push(
            makeShape(ctx, "rectangle", x1, b.y - 6, x2 - x1, h + 6, {
              backgroundColor: b.item.color ?? "#e7f5ff",
              fillStyle: "solid",
              strokeColor: "transparent",
              roughness: 0,
              opacity: 60,
            }),
          );
        } else {
          const gid = newGroupId();
          const frame = makeShape(ctx, "rectangle", x1, b.y - 6, x2 - x1, h + 6, { strokeWidth: 1, strokeColor: MUTED_STROKE, groupIds: [gid] });
          const tagText = b.item.block;
          const tm = measure(ctx, tagText, SMALL_FONT);
          const tag = makeShape(ctx, "rectangle", x1, b.y - 6, tm.width + 20, tm.height + 10, {
            strokeWidth: 1,
            strokeColor: MUTED_STROKE,
            backgroundColor: "#f1f3f5",
            fillStyle: "solid",
            groupIds: [gid],
          });
          const els: ExcalidrawElement[] = [frame, tag, addLabel(ctx, tag, tagText, SMALL_FONT)];
          if (b.item.label)
            els.push(
              makeText(ctx, `[${b.item.label}]`, {
                x: x1 + tm.width + 30,
                y: b.y - 6 + (tm.height + 10) / 2 - (SMALL_FONT * 1.25) / 2,
                fontSize: SMALL_FONT,
                align: "left",
                props: { groupIds: [gid] },
              }),
            );
          for (const s of b.sections) {
            els.push(
              makeLinear(ctx, "line", [[x1, s.y], [x2, s.y]], { strokeStyle: "dashed", strokeWidth: 1, color: MUTED_STROKE, props: { groupIds: [gid] } }),
            );
            if (s.label)
              els.push(makeText(ctx, `[${s.label}]`, { cx: (x1 + x2) / 2, y: s.y + 6, fontSize: SMALL_FONT, props: { groupIds: [gid] } }));
          }
          layers.blocks.push(...els);
        }
        y += 18;
        // nested: parent block encloses this one
        for (const p of blocks) {
          p.minX = Math.min(p.minX, x1);
          p.maxX = Math.max(p.maxX, x2);
        }
        break;
      }
    }
  }
  // close dangling activations
  for (const id of [...active.keys()]) while (activeDepth(id)) deactivate(id, y);

  const bottomY = y + 14;
  parts.forEach((p, i) => {
    const gid = newGroupId();
    layers.life.push(
      makeLinear(ctx, "line", [[cx[i], BOX_H], [cx[i], bottomY]], { strokeStyle: "dashed", strokeWidth: 1, color: MUTED_STROKE, props: { groupIds: [gid] } }),
    );
    for (const top of [0, bottomY]) layers.parts.push(...participant(ctx, p, labels[i], cx[i], top, widths[i], gid));
  });

  // participant boxes (`box ... end`)
  d.boxes.forEach((bx, bi) => {
    const members = parts.map((p, i) => (p.box === bi ? i : -1)).filter((i) => i >= 0);
    if (!members.length) return;
    const x1 = Math.min(...members.map((i) => cx[i] - widths[i] / 2)) - 14;
    const x2 = Math.max(...members.map((i) => cx[i] + widths[i] / 2)) + 14;
    const top = bx.label ? -40 : -14;
    layers.back.unshift(
      makeShape(ctx, "rectangle", x1, top, x2 - x1, bottomY + BOX_H + 14 - top, {
        backgroundColor: bx.color ?? "transparent",
        fillStyle: "solid",
        strokeWidth: 1,
        strokeColor: MUTED_STROKE,
        roughness: 0,
        opacity: bx.color ? 50 : 100,
      }),
    );
    if (bx.label) layers.back.push(makeText(ctx, bx.label, { cx: (x1 + x2) / 2, y: top + 8, fontSize: SMALL_FONT }));
  });

  const out = [...layers.back, ...layers.life, ...layers.act, ...layers.blocks, ...layers.fore, ...layers.parts];
  if (d.title) {
    const minX = cx[0] - widths[0] / 2;
    const maxX = cx[cx.length - 1] + widths[widths.length - 1] / 2;
    out.unshift(makeText(ctx, d.title, { cx: (minX + maxX) / 2, y: (d.boxes.some((b) => b.label) ? -40 : -14) - 44, fontSize: 24 }));
  }
  return out;
}

function participant(ctx: BuildCtx, p: SeqParticipant, label: string, cx: number, top: number, width: number, gid: string): ExcalidrawElement[] {
  if (!p.actor) {
    const rect = makeShape(ctx, "rectangle", cx - width / 2, top, width, BOX_H, { roundness: "round", groupIds: [gid] });
    return [rect, addLabel(ctx, rect, label, PART_FONT)];
  }
  // stick figure + name
  const g = { groupIds: [gid] };
  const m = measure(ctx, label, PART_FONT);
  const figH = BOX_H - Math.min(m.height, 26) - 4;
  const s = figH / 34; // figure designed 34 tall
  const head = makeShape(ctx, "ellipse", cx - 6 * s, top, 12 * s, 12 * s, g);
  const body = makeLinear(ctx, "line", [[cx, top + 12 * s], [cx, top + 24 * s]], { props: g });
  const arms = makeLinear(ctx, "line", [[cx - 10 * s, top + 16 * s], [cx + 10 * s, top + 16 * s]], { props: g });
  const legs = makeLinear(ctx, "line", [[cx - 9 * s, top + 34 * s], [cx, top + 24 * s], [cx + 9 * s, top + 34 * s]], { props: g });
  const text = makeText(ctx, label, { cx, y: top + figH + 4, fontSize: PART_FONT, props: g });
  return [head, body, arms, legs, text];
}
