// Presentation mode: frames become slides (ordered by x, then y).
import { getState, showToast } from "../core/store";
import type { AppState } from "../core/types";
import { zoomToFit } from "../core/viewport";
import { getOrderedFrames } from "./frames";

type Saved = Pick<AppState, "viewModeEnabled" | "activeTool" | "openSidebar" | "scrollX" | "scrollY" | "zoom" | "selectedElementIds">;
let saved: Saved | null = null;
let enteredFullscreen = false;

export const hasFrames = () => getOrderedFrames().length > 0;

export function fitSlide(index: number, animate = true) {
  const frames = getOrderedFrames();
  const frame = frames[index];
  if (frame) zoomToFit([frame], { padding: 20, maxZoom: 30, animate });
}

export function gotoSlide(index: number) {
  const s = getState();
  if (!s.appState.presentationMode) return;
  const n = getOrderedFrames().length;
  if (!n) return stopPresentation();
  const i = Math.max(0, Math.min(n - 1, index));
  s.setAppState({ presentationMode: { frameIndex: i } });
  fitSlide(i);
}

export const nextSlide = () => gotoSlide((getState().appState.presentationMode?.frameIndex ?? -1) + 1);
export const prevSlide = () => gotoSlide((getState().appState.presentationMode?.frameIndex ?? 1) - 1);

export async function startPresentation(startIndex = 0) {
  const s = getState();
  if (s.appState.presentationMode) return;
  const frames = getOrderedFrames();
  if (!frames.length) return showToast("Add frames to present — each frame becomes a slide.", "info");
  const { viewModeEnabled, activeTool, openSidebar, scrollX, scrollY, zoom, selectedElementIds } = s.appState;
  saved = { viewModeEnabled, activeTool, openSidebar, scrollX, scrollY, zoom, selectedElementIds };
  s.setAppState({
    presentationMode: { frameIndex: Math.min(startIndex, frames.length - 1) },
    viewModeEnabled: true,
    selectedElementIds: {},
    editingTextId: null,
    editingLinearId: null,
    editingGroupId: null,
    openSidebar: null,
    openDialog: null,
    openMenu: null,
    contextMenu: null,
    activeTool: "selection",
  });
  enteredFullscreen = false;
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen({ navigationUI: "hide" });
      enteredFullscreen = true;
    }
  } catch {
    // fullscreen denied (iframe, iOS Safari) — present in the window
  }
  // the canvas size changes after entering fullscreen; fit once now and again on resize
  fitSlide(getState().appState.presentationMode!.frameIndex);
}

export function stopPresentation() {
  const s = getState();
  if (!s.appState.presentationMode) return;
  const restore = saved;
  saved = null;
  s.setAppState({
    presentationMode: null,
    viewModeEnabled: restore?.viewModeEnabled ?? false,
    activeTool: restore?.activeTool ?? "selection",
    openSidebar: restore?.openSidebar ?? null,
    selectedElementIds: restore?.selectedElementIds ?? {},
    ...(restore ? { scrollX: restore.scrollX, scrollY: restore.scrollY, zoom: restore.zoom } : {}),
  });
  if (enteredFullscreen && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  enteredFullscreen = false;
}

/** The user left fullscreen (e.g. browser Esc) — end the presentation as well. */
export const didEnterFullscreen = () => enteredFullscreen;
