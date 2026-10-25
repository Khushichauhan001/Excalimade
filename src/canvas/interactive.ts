// Interactive layer: selection, handles, binding highlights, snap guides, laser/eraser trails, crop UI, link icons.
import type { AppState, ExcalidrawElement, ImageElement, LinearElement, Point } from "../core/types";
import { getElementBounds, getElementCenter, getViewportBounds, boundsIntersect } from "../core/geometry";
import { getAbsoluteOutline } from "../core/binding";
import { rotatePoint } from "../core/utils";
import { getImage } from "../render/images";
import type { BinaryFiles } from "../core/types";
import { session } from "./session";
import { getHandles, getTransformBox, usesPointHandles } from "./transform";

const LINK_ICON = new Path2D(
  "M8.5 11.5l3-3M7 9.5l-1.6 1.6a2.4 2.4 0 003.4 3.4L10.4 13M13 10.5l1.6-1.6a2.4 2.4 0 00-3.4-3.4L9.6 7",
);

export function getLinkIconBounds(el: ExcalidrawElement, zoom: number) {
  const [, y1, x2] = getElementBounds(el);
  const size = 22 / zoom;
  return { x: x2 + 4 / zoom, y: y1 - size - 2 / zoom, size };
}

export const LASER_DECAY_MS = 1000;

export function renderInteractive(
  canvas: HTMLCanvasElement,
  elements: readonly ExcalidrawElement[],
  as: AppState,
  files: BinaryFiles,
): boolean {
  const dpr = window.devicePixelRatio || 1;
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr * as.zoom, 0, 0, dpr * as.zoom, dpr * as.zoom * as.scrollX, dpr * as.zoom * as.scrollY);
  const z = as.zoom;
  const dark = as.theme === "dark";
  const primary = dark ? "#a8a5ff" : "#6965db";
  const lw = 1 / z;
  let animating = false;

  const byId = new Map(elements.map((e) => [e.id, e]));
  const selected = elements.filter((e) => !e.isDeleted && as.selectedElementIds[e.id]);
  const readOnly = as.viewModeEnabled || !!as.presentationMode;

  const outline = (el: ExcalidrawElement, color: string, width: number, dash?: number[]) => {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    if (dash) ctx.setLineDash(dash.map((d) => d / z));
    const c = getElementCenter(el);
    if (el.type === "arrow" || el.type === "line" || el.type === "freedraw") {
      const [x1, y1, x2, y2] = getElementBounds(el);
      const pad = 4 / z;
      ctx.strokeRect(x1 - pad, y1 - pad, x2 - x1 + pad * 2, y2 - y1 + pad * 2);
    } else {
      ctx.translate(c[0], c[1]);
      ctx.rotate(el.angle);
      const pad = 4 / z;
      ctx.strokeRect(-el.width / 2 - pad, -el.height / 2 - pad, el.width + pad * 2, el.height + pad * 2);
    }
    ctx.restore();
  };

  // ---- binding target / frame target highlight
  if (session.bindTarget && byId.get(session.bindTarget)) {
    const el = byId.get(session.bindTarget)!;
    ctx.save();
    ctx.strokeStyle = dark ? "rgba(168,165,255,0.55)" : "rgba(105,101,219,0.45)";
    ctx.lineWidth = 6 / z;
    ctx.lineJoin = "round";
    const o = getAbsoluteOutline(el);
    ctx.beginPath();
    o.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
  if (session.frameTarget && byId.get(session.frameTarget)) {
    const f = byId.get(session.frameTarget)!;
    ctx.save();
    ctx.strokeStyle = primary;
    ctx.lineWidth = 2 / z;
    ctx.strokeRect(f.x, f.y, f.width, f.height);
    ctx.restore();
  }

  // ---- image crop UI
  if (as.croppingImageId) {
    const img = byId.get(as.croppingImageId) as ImageElement | undefined;
    if (img) drawCropUI(ctx, img, files, z, primary);
  }

  // ---- selection
  if (selected.length && !readOnly && !as.croppingImageId) {
    const editingText = as.editingTextId;
    const multi = selected.length > 1;
    for (const el of selected) {
      if (el.id === editingText) continue;
      if (multi || el.locked || (el.type !== "text" && !usesPointHandles(el)) || el.type === "text") {
        if (multi) outline(el, primary, lw, el.locked ? [4, 4] : undefined);
      }
    }
    const unlocked = selected.filter((e) => !e.locked);
    const allLocked = unlocked.length !== selected.length;
    const box = !allLocked && !editingText ? getTransformBox(unlocked) : null;
    if (allLocked) for (const el of selected) outline(el, primary, lw, [4, 4]);
    if (box) {
      const single = unlocked.length === 1 ? unlocked[0] : null;
      ctx.save();
      const c: Point = [box.x + box.w / 2, box.y + box.h / 2];
      ctx.translate(c[0], c[1]);
      ctx.rotate(box.angle);
      ctx.strokeStyle = primary;
      ctx.lineWidth = lw;
      const pad = 4 / z;
      if (multi) ctx.setLineDash([4 / z, 3 / z]);
      ctx.strokeRect(-box.w / 2 - pad, -box.h / 2 - pad, box.w + pad * 2, box.h + pad * 2);
      ctx.restore();
      const handles = getHandles(box, z, {
        vertical: !(single?.type === "text"),
        rotation: !(single?.type === "frame") && !(single?.type === "text" && (single as any).containerId),
      });
      const hs = (window.matchMedia("(pointer: coarse)").matches ? 12 : 8) / z;
      for (const [name, [hx, hy]] of Object.entries(handles)) {
        ctx.save();
        ctx.fillStyle = dark ? "#232329" : "#fff";
        ctx.strokeStyle = primary;
        ctx.lineWidth = lw;
        ctx.beginPath();
        if (name === "rotation") ctx.arc(hx, hy, hs / 2, 0, Math.PI * 2);
        else {
          ctx.translate(hx, hy);
          ctx.rotate(box.angle);
          ctx.roundRect(-hs / 2, -hs / 2, hs, hs, 2 / z);
        }
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }
    // point handles for lines/arrows
    const linear =
      (as.editingLinearId && (byId.get(as.editingLinearId) as LinearElement | undefined)) ||
      (selected.length === 1 && usesPointHandles(selected[0]) && !selected[0].locked ? (selected[0] as LinearElement) : null);
    if (linear && !linear.isDeleted && !editingText) drawPointHandles(ctx, linear, z, primary, dark, !!as.editingLinearId);
  }

  // multi-point line in progress: show committed points
  if (session.multiPoint) {
    const el = byId.get(session.multiPoint.id) as LinearElement | undefined;
    if (el) {
      ctx.save();
      ctx.fillStyle = primary;
      for (const [px, py] of el.points.slice(0, -1)) {
        ctx.beginPath();
        ctx.arc(el.x + px, el.y + py, 4 / z, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ---- link icons
  if (!as.editingTextId) {
    const view = getViewportBounds(as);
    for (const el of elements) {
      if (el.isDeleted || !el.link || el.type === "embeddable" || !boundsIntersect(getElementBounds(el), view)) continue;
      const b = getLinkIconBounds(el, z);
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.scale(b.size / 20, b.size / 20);
      ctx.fillStyle = dark ? "#2e2d39" : "#fff";
      ctx.strokeStyle = dark ? "#555" : "#ddd";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(0, 0, 20, 20, 5);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = primary;
      ctx.lineWidth = 1.6;
      ctx.lineCap = "round";
      ctx.stroke(LINK_ICON);
      ctx.restore();
    }
  }

  // ---- box selection
  if (session.boxSelection) {
    const { x1, y1, x2, y2 } = session.boxSelection;
    ctx.save();
    ctx.fillStyle = dark ? "rgba(168,165,255,0.08)" : "rgba(105,101,219,0.08)";
    ctx.strokeStyle = primary;
    ctx.lineWidth = lw;
    ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    ctx.restore();
  }

  // ---- snap lines
  if (session.snapLines.length) {
    ctx.save();
    ctx.strokeStyle = "#ff6b6b";
    ctx.lineWidth = lw;
    for (const l of session.snapLines) {
      ctx.beginPath();
      if (l.axis === "x") {
        ctx.moveTo(l.at, l.from);
        ctx.lineTo(l.at, l.to);
      } else {
        ctx.moveTo(l.from, l.at);
        ctx.lineTo(l.to, l.at);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---- laser & eraser trails (fade out)
  const now = performance.now();
  session.laserTrail = session.laserTrail.filter((p) => now - p.t < LASER_DECAY_MS);
  if (session.laserTrail.length) {
    animating = true;
    drawTrail(ctx, session.laserTrail, now, LASER_DECAY_MS, "255,40,40", 4 / z, true);
  }
  session.eraserTrail = session.eraserTrail.filter((p) => now - p.t < 250);
  if (session.eraserTrail.length) {
    animating = true;
    drawTrail(ctx, session.eraserTrail, now, 250, dark ? "200,200,200" : "120,120,120", 3 / z, false);
  }
  return animating;
}

function drawTrail(ctx: CanvasRenderingContext2D, pts: { x: number; y: number; t: number }[], now: number, decay: number, rgb: string, width: number, glow: boolean) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (glow) {
    ctx.shadowColor = `rgba(${rgb},0.6)`;
    ctx.shadowBlur = 8;
  }
  for (let i = 1; i < pts.length; i++) {
    const age = (now - pts[i].t) / decay;
    const k = Math.max(0, 1 - age);
    ctx.strokeStyle = `rgba(${rgb},${k})`;
    ctx.lineWidth = width * (0.4 + 0.6 * k);
    ctx.beginPath();
    ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
    ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawPointHandles(ctx: CanvasRenderingContext2D, el: LinearElement, z: number, primary: string, dark: boolean, editing: boolean) {
  const c = getElementCenter(el);
  const abs = el.points.map(([px, py]) => rotatePoint([el.x + px, el.y + py], c, el.angle));
  ctx.save();
  if (editing) {
    ctx.strokeStyle = primary;
    ctx.lineWidth = 1 / z;
    ctx.setLineDash([3 / z, 3 / z]);
    ctx.beginPath();
    abs.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    ctx.setLineDash([]);
  }
  const touch = window.matchMedia("(pointer: coarse)").matches;
  const r = (touch ? 7 : 5) / z;
  const drawn = el.polygon ? abs.slice(0, -1) : abs;
  drawn.forEach(([x, y], i) => {
    const sel = editing && session.linearSelectedPoints.includes(i);
    const hov = session.hoveredLinearPoint === i;
    ctx.beginPath();
    ctx.arc(x, y, hov ? r * 1.3 : r, 0, Math.PI * 2);
    ctx.fillStyle = sel ? primary : dark ? "#232329" : "#fff";
    ctx.strokeStyle = primary;
    ctx.lineWidth = 1.5 / z;
    ctx.fill();
    ctx.stroke();
  });
  // midpoints (add a point)
  if (el.arrowType !== "elbow") {
    for (let i = 0; i < abs.length - 1; i++) {
      const a = abs[i], b = abs[i + 1];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) * z < 36) continue;
      ctx.beginPath();
      ctx.arc((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, r * 0.7, 0, Math.PI * 2);
      ctx.fillStyle = dark ? "rgba(168,165,255,0.35)" : "rgba(105,101,219,0.3)";
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawCropUI(ctx: CanvasRenderingContext2D, el: ImageElement, files: BinaryFiles, z: number, primary: string) {
  const image = getImage(el.fileId, files);
  if (!image) return;
  const natW = el.crop?.naturalWidth ?? image.naturalWidth;
  const natH = el.crop?.naturalHeight ?? image.naturalHeight;
  const crop = el.crop ?? { x: 0, y: 0, width: natW, height: natH };
  const k = el.width / crop.width;
  const c = getElementCenter(el);
  ctx.save();
  ctx.translate(c[0], c[1]);
  ctx.rotate(el.angle);
  ctx.translate(-el.width / 2, -el.height / 2);
  // whole image ghosted behind the crop window
  ctx.save();
  ctx.globalAlpha = 0.35;
  const [sx, sy] = el.scale;
  const fullX = sx < 0 ? -(natW - crop.x - crop.width) * k : -crop.x * k;
  const fullY = sy < 0 ? -(natH - crop.y - crop.height) * k : -crop.y * k;
  ctx.translate(fullX + (sx < 0 ? natW * k : 0), fullY + (sy < 0 ? natH * k : 0));
  ctx.scale(sx, sy);
  ctx.drawImage(image, 0, 0, natW * k, natH * k);
  ctx.restore();
  ctx.strokeStyle = primary;
  ctx.lineWidth = 1.5 / z;
  ctx.strokeRect(0, 0, el.width, el.height);
  // rule-of-thirds guides
  ctx.lineWidth = 0.75 / z;
  ctx.strokeStyle = "rgba(255,255,255,0.8)";
  for (const f of [1 / 3, 2 / 3]) {
    ctx.beginPath();
    ctx.moveTo(el.width * f, 0);
    ctx.lineTo(el.width * f, el.height);
    ctx.moveTo(0, el.height * f);
    ctx.lineTo(el.width, el.height * f);
    ctx.stroke();
  }
  // corner brackets
  ctx.strokeStyle = primary;
  ctx.lineWidth = 4 / z;
  const L = Math.min(18 / z, el.width / 3, el.height / 3);
  const corners: [number, number, number, number][] = [
    [0, 0, 1, 1], [el.width, 0, -1, 1], [0, el.height, 1, -1], [el.width, el.height, -1, -1],
  ];
  for (const [x, y, dx, dy] of corners) {
    ctx.beginPath();
    ctx.moveTo(x + dx * L, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + dy * L);
    ctx.stroke();
  }
  ctx.restore();
}
