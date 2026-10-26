import { getNonDeletedElements, getState } from "../core/store";
import type { FrameElement } from "../core/types";

/**
 * All frames in slide order: the scene's saved custom order first, then any frames not in it
 * (new ones) left→right, then top→bottom.
 */
export function getSlideFrames(elements = getNonDeletedElements(), order = getState().appState.slides?.order ?? []) {
  const frames = elements.filter((e) => e.type === "frame") as FrameElement[];
  const rank = new Map(order.map((id, i) => [id, i]));
  return frames.sort((a, b) => {
    const ra = rank.get(a.id), rb = rank.get(b.id);
    if (ra !== undefined && rb !== undefined) return ra - rb;
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    return a.x - b.x || a.y - b.y;
  });
}

/** Frames that are presented (and exported to PDF), in slide order — skipped slides excluded. */
export const getOrderedFrames = (elements = getNonDeletedElements()) => {
  const hidden = new Set(getState().appState.slides?.hidden ?? []);
  return getSlideFrames(elements).filter((f) => !hidden.has(f.id));
};
