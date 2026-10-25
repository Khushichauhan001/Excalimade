import { getState, getNonDeletedElements } from "./store";
import type { ExcalidrawElement } from "./types";
import { getCommonBounds } from "./geometry";
import { clamp } from "./utils";

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 30;

/** Zoom keeping the given viewport point (CSS px, relative to canvas) fixed. Defaults to the centre. */
export function setZoom(nextZoom: number, anchor?: { x: number; y: number }) {
  const { appState, setAppState } = getState();
  const zoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
  const ax = anchor?.x ?? appState.width / 2;
  const ay = anchor?.y ?? appState.height / 2;
  // scene point under the anchor must stay under the anchor
  const sx = ax / appState.zoom - appState.scrollX;
  const sy = ay / appState.zoom - appState.scrollY;
  setAppState({ zoom, scrollX: ax / zoom - sx, scrollY: ay / zoom - sy });
}

export const zoomIn = () => setZoom(stepZoom(getState().appState.zoom, 1));
export const zoomOut = () => setZoom(stepZoom(getState().appState.zoom, -1));
export const resetZoom = () => setZoom(1);

const stepZoom = (z: number, dir: 1 | -1) => {
  const step = z < 1 ? 0.1 : z < 2 ? 0.2 : 0.5;
  return Math.round((z + dir * step) * 100) / 100;
};

/** Scroll (and optionally zoom) so the given elements fill the viewport. */
export function zoomToFit(elements?: ExcalidrawElement[], opts: { maxZoom?: number; padding?: number; animate?: boolean } = {}) {
  const { appState, setAppState } = getState();
  const els = elements ?? getNonDeletedElements();
  if (!els.length) {
    setAppState({ scrollX: 0, scrollY: 0, zoom: 1 });
    return;
  }
  const [x1, y1, x2, y2] = getCommonBounds(els);
  const padding = opts.padding ?? 60;
  const w = Math.max(x2 - x1, 1);
  const h = Math.max(y2 - y1, 1);
  const zoom = clamp(
    Math.min((appState.width - padding * 2) / w, (appState.height - padding * 2) / h, opts.maxZoom ?? 1),
    MIN_ZOOM,
    MAX_ZOOM,
  );
  const target = {
    zoom,
    scrollX: appState.width / 2 / zoom - (x1 + x2) / 2,
    scrollY: appState.height / 2 / zoom - (y1 + y2) / 2,
  };
  if (opts.animate) animateViewport(target);
  else setAppState(target);
}

/** Centre the viewport on an element (used by find, in-canvas links, follow mode). */
export function scrollToElements(elements: ExcalidrawElement[], fit = false) {
  if (fit) return zoomToFit(elements, { animate: true, maxZoom: 1.5 });
  const { appState } = getState();
  const [x1, y1, x2, y2] = getCommonBounds(elements);
  animateViewport({
    zoom: appState.zoom,
    scrollX: appState.width / 2 / appState.zoom - (x1 + x2) / 2,
    scrollY: appState.height / 2 / appState.zoom - (y1 + y2) / 2,
  });
}

let anim = 0;
export function animateViewport(target: { scrollX: number; scrollY: number; zoom: number }, duration = 300) {
  const { appState, setAppState } = getState();
  const from = { scrollX: appState.scrollX, scrollY: appState.scrollY, zoom: appState.zoom };
  const start = performance.now();
  const id = ++anim;
  const ease = (t: number) => 1 - Math.pow(1 - t, 3);
  const tick = (now: number) => {
    if (id !== anim) return;
    const t = Math.min(1, (now - start) / duration);
    const k = ease(t);
    setAppState({
      scrollX: from.scrollX + (target.scrollX - from.scrollX) * k,
      scrollY: from.scrollY + (target.scrollY - from.scrollY) * k,
      zoom: from.zoom + (target.zoom - from.zoom) * k,
    });
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
