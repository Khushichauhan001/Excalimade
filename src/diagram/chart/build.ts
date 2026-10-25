// Chart data → hand-drawn Excalidraw elements (bar / grouped bar / line), all in one group.
import type { ExcalidrawElement, Point } from "../../core/types";
import { type BuildCtx, type BuildOptions, MUTED_STROKE, STROKE, makeCtx, makeLinear, makeShape, makeText, measure, newGroupId, normalizePosition } from "../mermaid/common";
import type { ChartData } from "./table";

export type ChartType = "bar" | "line";

/** Series colours: Excalidraw stroke/background pairs, ordered so adjacent series stay distinct for colour-blind readers. */
export const CHART_COLORS = [
  { stroke: "#1971c2", bg: "#a5d8ff" },
  { stroke: "#e8590c", bg: "#ffd8a8" },
  { stroke: "#6741d9", bg: "#d0bfff" },
  { stroke: "#2f9e44", bg: "#b2f2bb" },
  { stroke: "#c2255c", bg: "#fcc2d7" },
  { stroke: "#f08c00", bg: "#ffec99" },
];
export const MAX_SERIES = CHART_COLORS.length;

const PLOT_H = 300;
const FONT = 16;
const TICK_FONT = 14;

function niceStep(range: number, ticks: number) {
  const raw = range / ticks || 1;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

export function formatValue(v: number, data: Pick<ChartData, "percent" | "currency">) {
  const abs = Math.abs(v);
  let s: string;
  if (abs >= 1e9) s = `${+(v / 1e9).toFixed(1)}B`;
  else if (abs >= 1e6) s = `${+(v / 1e6).toFixed(1)}M`;
  else if (abs >= 1e4) s = `${+(v / 1e3).toFixed(1)}k`;
  else s = Number.isInteger(v) ? v.toLocaleString("en-US") : (+v.toFixed(2)).toLocaleString("en-US");
  if (data.percent) s += "%";
  if (data.currency && data.currency.length === 1) s = v < 0 ? `-${data.currency}${s.slice(1)}` : `${data.currency}${s}`;
  return s;
}

function fitLabel(ctx: BuildCtx, label: string, maxW: number) {
  if (measure(ctx, label, TICK_FONT).width <= maxW) return label;
  let s = label;
  while (s.length > 1 && measure(ctx, `${s}…`, TICK_FONT).width > maxW) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

export function buildChart(data: ChartData, opts: { type: ChartType; title?: string } & BuildOptions): ExcalidrawElement[] {
  const ctx = makeCtx({ ...opts, arrowStyle: "sharp" });
  const gid = newGroupId();
  const g = { groupIds: [gid] };
  const series = data.series.slice(0, MAX_SERIES);
  const n = data.labels.length;
  const multi = series.length > 1;
  const all = series.flatMap((s) => s.values);
  let lo = Math.min(0, ...all);
  let hi = Math.max(0, ...all);
  if (hi === lo) hi = lo + 1;
  const step = niceStep(hi - lo, 5);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const yOf = (v: number) => PLOT_H - ((v - lo) / (hi - lo)) * PLOT_H;

  // horizontal geometry
  const barW = opts.type === "bar" ? (multi ? Math.max(14, 34 - series.length * 3) : 36) : 0;
  const innerGap = multi ? 4 : 0;
  const groupW = opts.type === "bar" ? series.length * barW + (series.length - 1) * innerGap : 0;
  const slot = opts.type === "bar" ? groupW + (multi ? 32 : 20) : Math.max(56, Math.min(110, 700 / Math.max(n, 1)));
  const plotW = slot * n + (opts.type === "line" ? 0 : 16);
  const xOf = (i: number) => 16 + slot * i + slot / 2;

  const out: ExcalidrawElement[] = [];
  const muted = { color: MUTED_STROKE, strokeWidth: 1, props: g };

  // gridlines + y tick labels
  for (let v = lo; v <= hi + step / 2; v += step) {
    const y = yOf(v);
    if (Math.abs(v) > step / 1000) out.push(makeLinear(ctx, "line", [[0, y], [plotW, y]], { ...muted, strokeStyle: "dotted", props: { ...g, opacity: 60 } }));
    const t = makeText(ctx, formatValue(+v.toPrecision(12), data), { x: 0, y: 0, fontSize: TICK_FONT, align: "right", color: MUTED_STROKE, props: g });
    t.x = -12 - t.width;
    t.y = y - t.height / 2;
    out.push(t);
  }
  // axes
  out.push(makeLinear(ctx, "line", [[0, 0], [0, PLOT_H]], { color: STROKE, strokeWidth: 2, props: g }));
  out.push(makeLinear(ctx, "line", [[0, yOf(0)], [plotW, yOf(0)]], { color: STROKE, strokeWidth: 2, props: g }));

  const showValues = opts.type === "bar" ? n * series.length <= 30 : !multi && n <= 24;

  if (opts.type === "bar") {
    series.forEach((s, si) => {
      const col = CHART_COLORS[si];
      s.values.forEach((v, i) => {
        const x = xOf(i) - groupW / 2 + si * (barW + innerGap);
        const y0 = yOf(0);
        const y1 = yOf(v);
        const h = Math.max(Math.abs(y0 - y1), 1);
        out.push(
          makeShape(ctx, "rectangle", x, Math.min(y0, y1), barW, h, {
            backgroundColor: col.bg,
            strokeColor: col.stroke,
            fillStyle: "hachure",
            strokeWidth: 2,
            roundness: "sharp",
            ...g,
          }),
        );
        if (showValues) {
          const t = makeText(ctx, formatValue(v, data), { cx: x + barW / 2, y: 0, fontSize: multi ? 12 : TICK_FONT, props: g });
          t.y = v >= 0 ? y1 - t.height - 4 : y1 + 4;
          if (!multi || t.width <= barW + innerGap + 6) out.push(t);
        }
      });
    });
  } else {
    series.forEach((s, si) => {
      const col = CHART_COLORS[si];
      const pts: Point[] = s.values.map((v, i) => [xOf(i), yOf(v)]);
      if (pts.length > 1) out.push(makeLinear(ctx, "line", pts, { color: col.stroke, strokeWidth: 2, props: g }));
      pts.forEach(([x, y], i) => {
        out.push(makeShape(ctx, "ellipse", x - 5, y - 5, 10, 10, { backgroundColor: col.stroke, strokeColor: col.stroke, fillStyle: "solid", strokeWidth: 1, ...g }));
        if (showValues) out.push(makeText(ctx, formatValue(s.values[i], data), { cx: x, cy: y - 18, fontSize: TICK_FONT, props: g }));
      });
    });
  }

  // x labels
  const maxLabelW = Math.max(slot - 6, 40);
  data.labels.forEach((l, i) => {
    const t = makeText(ctx, fitLabel(ctx, l, maxLabelW), { cx: xOf(i), y: Math.max(yOf(0), PLOT_H) + 10, fontSize: TICK_FONT, props: g });
    out.push(t);
  });
  if (data.labelHeader) {
    const y = Math.max(yOf(0), PLOT_H) + 20 + TICK_FONT * 1.25;
    out.push(makeText(ctx, data.labelHeader, { cx: plotW / 2, y, fontSize: FONT, color: MUTED_STROKE, props: g }));
  }

  // title + legend above the plot
  let top = -24;
  if (multi) {
    let lx = 0;
    const items: ExcalidrawElement[] = [];
    series.forEach((s, si) => {
      const col = CHART_COLORS[si];
      items.push(makeShape(ctx, "rectangle", lx, 3, 14, 14, { backgroundColor: col.bg, strokeColor: col.stroke, fillStyle: "solid", strokeWidth: 1, ...g }));
      const t = makeText(ctx, s.name, { x: lx + 20, y: 0, fontSize: FONT, align: "left", props: g });
      items.push(t);
      lx += 20 + t.width + 22;
    });
    const dy = top - 24;
    for (const e of items) e.y += dy;
    out.push(...items);
    top = dy - 12;
  } else if (!opts.title && series[0]) {
    opts = { ...opts, title: series[0].name };
  }
  if (opts.title) {
    const t = makeText(ctx, opts.title, { x: 0, y: 0, fontSize: 24, align: "left", props: g });
    t.y = top - t.height;
    out.push(t);
  }
  return normalizePosition(out);
}
