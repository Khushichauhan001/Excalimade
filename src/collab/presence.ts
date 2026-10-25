// High-frequency presence data (remote cursors, laser trails) kept outside React/zustand.
// The overlay canvas reads it every animation frame.

export interface RemoteCursor {
  /** Target position (scene coords) from the latest update. */
  x: number;
  y: number;
  /** Interpolated position actually drawn. */
  dx: number;
  dy: number;
  tool: "pointer" | "laser";
  down: boolean;
  visible: boolean;
  updated: number;
}

export interface TrailPoint {
  x: number;
  y: number;
  t: number;
}

export const cursors = new Map<string, RemoteCursor>();
export const trails = new Map<string, TrailPoint[]>();
export const LASER_FADE_MS = 1000;

const listeners = new Set<() => void>();
export const onOverlayDirty = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};
export const markOverlayDirty = () => listeners.forEach((fn) => fn());

export function updateCursor(id: string, p: { x: number; y: number; tool: "pointer" | "laser" } | null, down: boolean) {
  const now = performance.now();
  let c = cursors.get(id);
  if (!p) {
    if (c) c.visible = false;
    markOverlayDirty();
    return;
  }
  if (!c || !c.visible) {
    c = { x: p.x, y: p.y, dx: p.x, dy: p.y, tool: p.tool, down, visible: true, updated: now };
    cursors.set(id, c);
  } else {
    c.x = p.x;
    c.y = p.y;
    c.tool = p.tool;
    c.down = down;
    c.updated = now;
  }
  if (p.tool === "laser" && down) {
    let t = trails.get(id);
    if (!t) trails.set(id, (t = []));
    t.push({ x: p.x, y: p.y, t: now });
    if (t.length > 400) t.splice(0, t.length - 400);
  }
  markOverlayDirty();
}

export function removeCursor(id: string) {
  cursors.delete(id);
  trails.delete(id);
  markOverlayDirty();
}

export function clearPresence() {
  cursors.clear();
  trails.clear();
  markOverlayDirty();
}
