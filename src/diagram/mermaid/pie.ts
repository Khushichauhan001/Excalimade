// Mermaid `pie` parser and converter: sectors drawn as closed `line` polygons, with a legend.
import type { ExcalidrawElement } from "../../core/types";
import type { Point } from "../../core/types";
import { type BuildCtx, type Stmt, MermaidError, PALETTE, SMALL_FONT, cleanLabel, makeLinear, makeShape, makeText, newGroupId } from "./common";

export interface PieChart {
  type: "pie";
  title?: string;
  showData: boolean;
  slices: { label: string; value: number }[];
}

export function parsePie(stmts: Stmt[], title?: string): PieChart {
  const hm = /^pie(\s+showData)?(?:\s+title\s+(.+))?$/i.exec(stmts[0].text);
  if (!hm) throw new MermaidError(`Invalid pie header "${stmts[0].text}"`, stmts[0].line);
  const d: PieChart = { type: "pie", title: hm[2] ? cleanLabel(hm[2]) : title, showData: !!hm[1], slices: [] };
  for (let k = 1; k < stmts.length; k++) {
    const { text, line } = stmts[k];
    let m: RegExpExecArray | null;
    if ((m = /^title\s+(.+)$/i.exec(text))) {
      d.title = cleanLabel(m[1]);
      continue;
    }
    if (/^showData$/i.test(text)) {
      d.showData = true;
      continue;
    }
    if (/^(accTitle|accDescr)\b/.test(text)) continue;
    if ((m = /^"([^"]+)"\s*:\s*([-+]?[\d.]+(?:e[-+]?\d+)?)$/i.exec(text))) {
      const value = Number(m[2]);
      if (!Number.isFinite(value) || value < 0) throw new MermaidError(`Invalid value "${m[2]}" (must be a positive number)`, line);
      d.slices.push({ label: cleanLabel(m[1]), value });
      continue;
    }
    throw new MermaidError(`Expected "Label" : value, got "${text.slice(0, 40)}"`, line);
  }
  if (!d.slices.length) throw new MermaidError("Pie chart has no slices", stmts[0].line);
  return d;
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, ""));

export function pieToElements(d: PieChart, ctx: BuildCtx): ExcalidrawElement[] {
  const gid = newGroupId();
  const g = { groupIds: [gid] };
  const R = 160;
  const cx = R;
  const cy = R + (d.title ? 60 : 0);
  const total = d.slices.reduce((a, s) => a + s.value, 0) || 1;
  const out: ExcalidrawElement[] = [];
  if (d.title) out.push(makeText(ctx, d.title, { cx, y: 0, fontSize: 28, props: g }));

  const slices = d.slices.filter((s) => s.value > 0);
  let a0 = -Math.PI / 2;
  slices.forEach((s, i) => {
    const col = PALETTE[i % PALETTE.length];
    const frac = s.value / total;
    const a1 = a0 + frac * Math.PI * 2;
    if (slices.length === 1) {
      out.push(makeShape(ctx, "ellipse", cx - R, cy - R, R * 2, R * 2, { backgroundColor: col.bg, fillStyle: "solid", ...g }));
    } else {
      const pts: Point[] = [[cx, cy]];
      const steps = Math.max(2, Math.ceil((a1 - a0) / (Math.PI / 36)));
      for (let k = 0; k <= steps; k++) {
        const a = a0 + ((a1 - a0) * k) / steps;
        pts.push([cx + Math.cos(a) * R, cy + Math.sin(a) * R]);
      }
      pts.push([cx, cy]);
      out.push(
        makeLinear(ctx, "line", pts, {
          props: { polygon: true, backgroundColor: col.bg, fillStyle: "solid", roundness: "sharp", ...g },
        }),
      );
    }
    if (frac >= 0.04) {
      const mid = (a0 + a1) / 2;
      const r = slices.length === 1 ? 0 : R * 0.62;
      out.push(makeText(ctx, `${Math.round(frac * 100)}%`, { cx: cx + Math.cos(mid) * r, cy: cy + Math.sin(mid) * r, fontSize: SMALL_FONT, props: g }));
    }
    a0 = a1;
  });

  // legend
  const lx = cx + R + 50;
  let ly = cy - (slices.length * 30) / 2;
  slices.forEach((s, i) => {
    const col = PALETTE[i % PALETTE.length];
    out.push(makeShape(ctx, "rectangle", lx, ly + 2, 18, 18, { backgroundColor: col.bg, fillStyle: "solid", strokeWidth: 1, roughness: 0, ...g }));
    out.push(
      makeText(ctx, d.showData ? `${s.label} [${fmt(s.value)}]` : s.label, {
        x: lx + 28,
        y: ly,
        fontSize: SMALL_FONT + 2,
        align: "left",
        props: g,
      }),
    );
    ly += 30;
  });
  return out;
}
