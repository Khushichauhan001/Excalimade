import { RoughCanvas } from "roughjs/bin/canvas";
import { getStroke } from "perfect-freehand";
import type {
  BinaryFiles,
  EmbeddableElement,
  ExcalidrawElement,
  FreeDrawElement,
  ImageElement,
  TextElement,
} from "../core/types";
import { getElementAbsCoords } from "../core/geometry";
import { getFontString } from "../core/text";
import { getDrawables, isTransparent } from "./rough";
import { getImage } from "./images";

export interface RenderConfig {
  files: BinaryFiles;
  canvasBg: string;
  /** Dark theme is done with a CSS/ctx filter on the whole canvas; images get re-inverted. */
  darkMode: boolean;
  isExport: boolean;
  /** Elements drawn semi-transparent (pending eraser deletion). */
  fadedIds?: Set<string>;
  /** Text being edited in the overlay is not drawn on the canvas. */
  hiddenIds?: Set<string>;
}

export const DARK_FILTER = "invert(93%) hue-rotate(180deg)";

/** Freedraw outline (perfect-freehand) as SVG path data, cached by points array identity. */
const freedrawCache = new WeakMap<object, { size: number; d: string }>();
export function getFreeDrawPath(el: FreeDrawElement): string {
  const hit = freedrawCache.get(el.points);
  if (hit && hit.size === el.strokeWidth) return hit.d;
  const input = el.points.map(([x, y], i) => [x, y, el.pressures[i] ?? 0.5]);
  const stroke = getStroke(input, {
    size: el.strokeWidth * 4.25,
    thinning: 0.6,
    smoothing: 0.5,
    streamline: 0.5,
    simulatePressure: el.simulatePressure,
    easing: (t) => Math.sin((t * Math.PI) / 2),
    last: true,
  });
  let d = "";
  if (stroke.length) {
    d = `M${stroke[0][0].toFixed(2)} ${stroke[0][1].toFixed(2)} Q`;
    for (let i = 0; i < stroke.length; i++) {
      const [x0, y0] = stroke[i];
      const [x1, y1] = stroke[(i + 1) % stroke.length];
      d += `${x0.toFixed(2)} ${y0.toFixed(2)} ${((x0 + x1) / 2).toFixed(2)} ${((y0 + y1) / 2).toFixed(2)} `;
    }
    d += "Z";
  }
  freedrawCache.set(el.points, { size: el.strokeWidth, d });
  return d;
}

const path2dCache = new Map<string, Path2D>();
const toPath2D = (d: string) => {
  let p = path2dCache.get(d);
  if (!p) {
    p = new Path2D(d);
    if (path2dCache.size > 2000) path2dCache.clear();
    path2dCache.set(d, p);
  }
  return p;
};

/** Translate + rotate the context into the element's local frame (origin = element x,y). */
export function applyElementTransform(ctx: CanvasRenderingContext2D, el: ExcalidrawElement) {
  const [x1, y1, x2, y2] = getElementAbsCoords(el);
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
  ctx.translate(cx, cy);
  ctx.rotate(el.angle);
  ctx.translate(el.x - cx, el.y - cy);
}

export function drawText(ctx: CanvasRenderingContext2D, el: TextElement) {
  ctx.fillStyle = el.strokeColor;
  ctx.font = getFontString(el.fontSize, el.fontFamily);
  ctx.textBaseline = "middle";
  ctx.textAlign = el.textAlign;
  const lineH = el.fontSize * el.lineHeight;
  const x = el.textAlign === "center" ? el.width / 2 : el.textAlign === "right" ? el.width : 0;
  el.text.split("\n").forEach((line, i) => ctx.fillText(line, x, (i + 0.5) * lineH));
}

export function renderElement(ctx: CanvasRenderingContext2D, rc: RoughCanvas, el: ExcalidrawElement, cfg: RenderConfig) {
  if (cfg.hiddenIds?.has(el.id)) return;
  ctx.save();
  ctx.globalAlpha *= (el.opacity / 100) * (cfg.fadedIds?.has(el.id) ? 0.3 : 1);
  applyElementTransform(ctx, el);
  switch (el.type) {
    case "text":
      drawText(ctx, el as TextElement);
      break;
    case "freedraw": {
      const fd = el as FreeDrawElement;
      if (!isTransparent(fd.backgroundColor) && fd.points.length > 2) {
        ctx.fillStyle = fd.backgroundColor;
        ctx.beginPath();
        fd.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = fd.strokeColor;
      ctx.fill(toPath2D(getFreeDrawPath(fd)));
      break;
    }
    case "image":
      drawImageElement(ctx, el as ImageElement, cfg);
      break;
    case "embeddable":
      drawEmbeddablePlaceholder(ctx, rc, el as EmbeddableElement, cfg);
      break;
    case "frame":
      break; // frames are drawn by the scene renderer (outline + name above content)
    default:
      for (const d of getDrawables(el, cfg.canvasBg).shapes) rc.draw(d);
  }
  ctx.restore();
}

function drawImageElement(ctx: CanvasRenderingContext2D, el: ImageElement, cfg: RenderConfig) {
  const img = getImage(el.fileId, cfg.files);
  const w = el.width, h = el.height;
  if (!img) {
    // loading / missing file
    ctx.fillStyle = "rgba(0,0,0,0.05)";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(0,0,0,0.2)";
    ctx.setLineDash([6, 6]);
    ctx.strokeRect(0, 0, w, h);
    return;
  }
  ctx.save();
  if (cfg.darkMode) ctx.filter = DARK_FILTER; // cancel the canvas-wide invert for photos
  const [sx, sy] = el.scale;
  ctx.translate(sx < 0 ? w : 0, sy < 0 ? h : 0);
  ctx.scale(sx, sy);
  const c = el.crop;
  if (el.roundness === "round") {
    const r = Math.min(w, h) * 0.08;
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, r);
    ctx.clip();
  }
  if (c) ctx.drawImage(img, c.x, c.y, c.width, c.height, 0, 0, w, h);
  else ctx.drawImage(img, 0, 0, w, h);
  ctx.restore();
  if (!isTransparent(el.strokeColor)) {
    ctx.strokeStyle = el.strokeColor;
    ctx.lineWidth = el.strokeWidth;
    ctx.strokeRect(0, 0, w, h);
  }
}

function drawEmbeddablePlaceholder(ctx: CanvasRenderingContext2D, rc: RoughCanvas, el: EmbeddableElement, cfg: RenderConfig) {
  const w = el.width, h = el.height;
  ctx.fillStyle = cfg.isExport ? "#f6f6f9" : "rgba(105,101,219,0.06)";
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, 8);
  ctx.fill();
  for (const d of getDrawables(el, cfg.canvasBg).shapes) rc.draw(d);
  const label = el.customData?.html ? "Generated HTML" : (el.link ?? "Embed");
  ctx.fillStyle = "#6b6b76";
  ctx.font = `${Math.max(12, Math.min(18, w / 24))}px Nunito, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const maxChars = Math.max(8, Math.floor(w / 9));
  ctx.fillText(label.length > maxChars ? label.slice(0, maxChars - 1) + "…" : label, w / 2, h / 2);
}
