// Transient, non-persisted interaction state shared by the pointer controller and the
// interactive-layer renderer. Kept outside React/zustand because it changes on every pointer move.
import type { ExcalidrawElement, Point } from "../core/types";

export type HandleName = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se" | "rotation";

export interface SnapLine {
  axis: "x" | "y";
  at: number; // x for vertical lines, y for horizontal
  from: number;
  to: number;
}

export interface Session {
  /** Last known pointer position (scene coords) — used for paste position. */
  lastPointer: Point | null;
  /** Element the dragged arrow end would bind to. */
  bindTarget: string | null;
  /** Frame that would receive dragged elements. */
  frameTarget: string | null;
  boxSelection: { x1: number; y1: number; x2: number; y2: number } | null;
  snapLines: SnapLine[];
  laserTrail: { x: number; y: number; t: number }[];
  eraserTrail: { x: number; y: number; t: number }[];
  eraserPending: Set<string>;
  /** Multi-point line/arrow being created by successive clicks. */
  multiPoint: { id: string; cursor: Point } | null;
  /** Point indices selected in the linear editor. */
  linearSelectedPoints: number[];
  hoveredLinearPoint: number | null;
  /** Text overlay is open; the element is hidden on the canvas. */
  hiddenIds: Set<string>;
  /** Embeddable that receives pointer events (iframe interaction). */
  activeEmbedId: string | null;
  isDragging: boolean;
  /** Snapshot of elements at the start of a gesture (for diffing / cancel). */
  gestureStart: ExcalidrawElement[] | null;
}

export const session: Session = {
  lastPointer: null,
  bindTarget: null,
  frameTarget: null,
  boxSelection: null,
  snapLines: [],
  laserTrail: [],
  eraserTrail: [],
  eraserPending: new Set(),
  multiPoint: null,
  linearSelectedPoints: [],
  hoveredLinearPoint: null,
  hiddenIds: new Set(),
  activeEmbedId: null,
  isDragging: false,
  gestureStart: null,
};

let repaint: () => void = () => {};
/** Ask the canvas to repaint (interactive layer + static layer). */
export const requestRepaint = () => repaint();
export const setRepaintHandler = (fn: () => void) => {
  repaint = fn;
};
