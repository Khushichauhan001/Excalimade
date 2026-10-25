import { RoughCanvas } from "roughjs/bin/canvas";
import type { AppState, ExcalidrawElement, FrameElement } from "../core/types";
import { boundsIntersect, getElementBounds, getViewportBounds, type Bounds } from "../core/geometry";
import { renderElement, type RenderConfig } from "./renderElement";

export const FRAME_NAME_FONT = "500 14px Nunito, system-ui, sans-serif";
export const getFrameName = (f: FrameElement, index?: number) => f.name ?? `Frame${index !== undefined ? " " + (index + 1) : ""}`;

export interface DrawOptions {
  /** Draw frame outlines and names (off for exports and presentation mode). */
  frameChrome: boolean;
  /** Skip elements outside these scene bounds. */
  cullBounds?: Bounds;
  /** Clip everything to this frame (frame export). */
  clipFrame?: FrameElement;
}

/** Draw elements into a context already transformed to scene coordinates. */
export function drawElements(
  ctx: CanvasRenderingContext2D,
  rc: RoughCanvas,
  elements: readonly ExcalidrawElement[],
  cfg: RenderConfig,
  opts: DrawOptions,
) {
  const frames = new Map<string, FrameElement>();
  for (const el of elements) if (el.type === "frame" && !el.isDeleted) frames.set(el.id, el as FrameElement);

  if (opts.clipFrame) {
    const f = opts.clipFrame;
    ctx.save();
    ctx.beginPath();
    ctx.rect(f.x, f.y, f.width, f.height);
    ctx.clip();
  }

  for (const el of elements) {
    if (el.isDeleted || el.type === "frame") continue;
    if (opts.cullBounds && !boundsIntersect(getElementBounds(el), opts.cullBounds)) continue;
    const frame = el.frameId ? frames.get(el.frameId) : undefined;
    if (frame) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(frame.x, frame.y, frame.width, frame.height);
      ctx.clip();
      renderElement(ctx, rc, el, cfg);
      ctx.restore();
    } else {
      renderElement(ctx, rc, el, cfg);
    }
  }

  if (opts.clipFrame) ctx.restore();

  if (opts.frameChrome) {
    let i = 0;
    for (const f of frames.values()) {
      const index = i++;
      if (opts.cullBounds && !boundsIntersect(getElementBounds(f), opts.cullBounds)) continue;
      ctx.save();
      ctx.globalAlpha = f.opacity / 100;
      ctx.strokeStyle = cfg.darkMode ? "#888" : "#bbb";
      ctx.lineWidth = 1 / ctx.getTransform().a * (window.devicePixelRatio || 1);
      ctx.beginPath();
      ctx.roundRect(f.x, f.y, f.width, f.height, 8 / Math.max(ctx.getTransform().a / (window.devicePixelRatio || 1), 0.1));
      ctx.stroke();
      if (!cfg.hiddenIds?.has(f.id)) {
        const zoom = ctx.getTransform().a / (window.devicePixelRatio || 1);
        ctx.translate(f.x, f.y);
        ctx.scale(1 / zoom, 1 / zoom);
        ctx.font = FRAME_NAME_FONT;
        ctx.fillStyle = cfg.darkMode ? "#aaa" : "#777";
        ctx.textBaseline = "bottom";
        let name = getFrameName(f, index);
        const maxW = f.width * zoom;
        while (name.length > 1 && ctx.measureText(name).width > maxW) name = name.slice(0, -2) + "…";
        ctx.fillText(name, 0, -6);
      }
      ctx.restore();
    }
  }
}

function drawGrid(ctx: CanvasRenderingContext2D, as: AppState, dark: boolean) {
  const { zoom, scrollX, scrollY, width, height, gridSize } = as;
  const step = gridSize * zoom;
  if (step < 4) return;
  const majorEvery = 5;
  const offX = (scrollX * zoom) % step;
  const offY = (scrollY * zoom) % step;
  const startIX = Math.floor(-scrollX / gridSize);
  const startIY = Math.floor(-scrollY / gridSize);
  ctx.save();
  ctx.lineWidth = 1;
  for (let i = 0, x = offX; x < width; x += step, i++) {
    const major = (startIX + i + 1) % majorEvery === 0;
    if (!major && step < 10) continue;
    ctx.strokeStyle = major ? (dark ? "#d4d4d4" : "#dddddd") : dark ? "#e8e8e8" : "#efefef";
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, 0);
    ctx.lineTo(Math.round(x) + 0.5, height);
    ctx.stroke();
  }
  for (let i = 0, y = offY; y < height; y += step, i++) {
    const major = (startIY + i + 1) % majorEvery === 0;
    if (!major && step < 10) continue;
    ctx.strokeStyle = major ? (dark ? "#d4d4d4" : "#dddddd") : dark ? "#e8e8e8" : "#efefef";
    ctx.beginPath();
    ctx.moveTo(0, Math.round(y) + 0.5);
    ctx.lineTo(width, Math.round(y) + 0.5);
    ctx.stroke();
  }
  ctx.restore();
}

/** Paint the static scene (background, grid, elements, frames) onto the on-screen canvas. */
export function renderStaticScene(
  canvas: HTMLCanvasElement,
  elements: readonly ExcalidrawElement[],
  as: AppState,
  cfg: Omit<RenderConfig, "canvasBg" | "darkMode" | "isExport">,
) {
  const dpr = window.devicePixelRatio || 1;
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = as.viewBackgroundColor;
  ctx.fillRect(0, 0, as.width, as.height);
  const dark = as.theme === "dark";
  if (as.gridModeEnabled) drawGrid(ctx, as, dark);
  ctx.scale(as.zoom, as.zoom);
  ctx.translate(as.scrollX, as.scrollY);
  const rc = new RoughCanvas(canvas);
  drawElements(
    ctx,
    rc,
    elements,
    { ...cfg, canvasBg: as.viewBackgroundColor, darkMode: dark, isExport: false },
    { frameChrome: !as.presentationMode, cullBounds: getViewportBounds(as) },
  );
}
