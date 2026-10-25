import { getNonDeletedElements } from "../core/store";
import type { FrameElement } from "../core/types";

/** Frames in presentation order: left→right, then top→bottom. */
export const getOrderedFrames = (elements = getNonDeletedElements()) =>
  (elements.filter((e) => e.type === "frame") as FrameElement[]).sort((a, b) => a.x - b.x || a.y - b.y);
