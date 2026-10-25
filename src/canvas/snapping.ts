import type { ExcalidrawElement, Point } from "../core/types";
import { boundsIntersect, getElementBounds, getViewportBounds, type Bounds } from "../core/geometry";
import type { AppState } from "../core/types";
import type { SnapLine } from "./session";

export const snapToGrid = (v: number, grid: number) => Math.round(v / grid) * grid;
export const snapPointToGrid = (p: Point, grid: number): Point => [snapToGrid(p[0], grid), snapToGrid(p[1], grid)];

/**
 * Snap a moving bounds box to other elements' edges and centres.
 * Returns the correction offset and the guide lines to draw.
 */
export function snapBounds(
  moving: Bounds,
  elements: readonly ExcalidrawElement[],
  excludeIds: Set<string>,
  as: AppState,
): { dx: number; dy: number; lines: SnapLine[] } {
  const threshold = 8 / as.zoom;
  const view = getViewportBounds(as);
  const targets: Bounds[] = [];
  for (const el of elements) {
    if (el.isDeleted || excludeIds.has(el.id)) continue;
    const b = getElementBounds(el);
    if (boundsIntersect(b, view)) targets.push(b);
  }
  const mx = [moving[0], (moving[0] + moving[2]) / 2, moving[2]];
  const my = [moving[1], (moving[1] + moving[3]) / 2, moving[3]];
  let bestX: { d: number; at: number; from: number } | null = null;
  let bestY: { d: number; at: number; from: number } | null = null;
  for (const t of targets) {
    const tx = [t[0], (t[0] + t[2]) / 2, t[2]];
    const ty = [t[1], (t[1] + t[3]) / 2, t[3]];
    for (const a of mx) for (const b of tx) {
      const d = b - a;
      if (Math.abs(d) <= threshold && (!bestX || Math.abs(d) < Math.abs(bestX.d))) bestX = { d, at: b, from: a };
    }
    for (const a of my) for (const b of ty) {
      const d = b - a;
      if (Math.abs(d) <= threshold && (!bestY || Math.abs(d) < Math.abs(bestY.d))) bestY = { d, at: b, from: a };
    }
  }
  const dx = bestX?.d ?? 0;
  const dy = bestY?.d ?? 0;
  const lines: SnapLine[] = [];
  const snapped: Bounds = [moving[0] + dx, moving[1] + dy, moving[2] + dx, moving[3] + dy];
  // guide lines span from the moving box to every aligned target
  if (bestX) {
    let from = snapped[1], to = snapped[3];
    for (const t of targets) {
      if ([t[0], (t[0] + t[2]) / 2, t[2]].some((v) => Math.abs(v - bestX!.at) < 0.5)) {
        from = Math.min(from, t[1]);
        to = Math.max(to, t[3]);
      }
    }
    lines.push({ axis: "x", at: bestX.at, from, to });
  }
  if (bestY) {
    let from = snapped[0], to = snapped[2];
    for (const t of targets) {
      if ([t[1], (t[1] + t[3]) / 2, t[3]].some((v) => Math.abs(v - bestY!.at) < 0.5)) {
        from = Math.min(from, t[0]);
        to = Math.max(to, t[2]);
      }
    }
    lines.push({ axis: "y", at: bestY.at, from, to });
  }
  return { dx, dy, lines };
}

/** Snap a single point (creation / resize) to element edges. */
export function snapPoint(p: Point, elements: readonly ExcalidrawElement[], excludeIds: Set<string>, as: AppState) {
  const r = snapBounds([p[0], p[1], p[0], p[1]], elements, excludeIds, as);
  return { point: [p[0] + r.dx, p[1] + r.dy] as Point, lines: r.lines };
}
