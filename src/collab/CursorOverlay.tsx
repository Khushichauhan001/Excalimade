// Remote cursors, laser trails and remote selections drawn on a canvas above the scene (z-index 4).
import { useEffect, useRef } from "react";
import { getState, useStore } from "../core/store";
import type { ExcalidrawElement } from "../core/types";
import { getElementBounds } from "../core/geometry";
import { sceneToViewport } from "../core/utils";
import { cursors, LASER_FADE_MS, onOverlayDirty, trails } from "./presence";
import { colorForId } from "./state";

const CURSOR_PATH = new Path2D("M0 0 L0 17 L4.6 12.6 L7.6 19.4 L10.6 18.1 L7.7 11.5 L13.6 11.5 Z");
const LASER_COLOR = "#ff2f2f";

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function nameTag(ctx: CanvasRenderingContext2D, x: number, y: number, name: string, color: string) {
  ctx.font = "600 12px Nunito, system-ui, sans-serif";
  const w = Math.min(ctx.measureText(name).width, 160) + 12;
  roundRect(ctx, x, y, w, 20, 6);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "middle";
  ctx.fillText(name, x + 6, y + 10.5, 160);
}

export function CursorOverlay() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let running = false;
    let last = performance.now();
    let elementsRef: readonly ExcalidrawElement[] | null = null;
    let byId = new Map<string, ExcalidrawElement>();
    let width = 0;
    let height = 0;
    let dpr = 1;

    const resize = () => {
      dpr = window.devicePixelRatio || 1;
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      kick();
    };

    const draw = (dt: number, now: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const { appState, elements } = getState();
      const collaborators = appState.collaborators;
      let animating = false;

      // remote selections
      for (const [id, c] of Object.entries(collaborators)) {
        const ids = c.selectedElementIds;
        if (!ids?.length) continue;
        if (elementsRef !== elements) {
          elementsRef = elements;
          byId = new Map(elements.map((e) => [e.id, e]));
        }
        const color = c.color || colorForId(id);
        let labelAt: [number, number] | null = null;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([]);
        for (const sel of ids) {
          const el = byId.get(sel);
          if (!el || el.isDeleted) continue;
          const [x1, y1, x2, y2] = getElementBounds(el);
          const [vx1, vy1] = sceneToViewport(x1, y1, appState);
          const [vx2, vy2] = sceneToViewport(x2, y2, appState);
          const pad = 5;
          if (vx2 < -pad || vy2 < -pad || vx1 > width + pad || vy1 > height + pad) continue;
          roundRect(ctx, vx1 - pad, vy1 - pad, vx2 - vx1 + pad * 2, vy2 - vy1 + pad * 2, 4);
          ctx.stroke();
          if (!labelAt || vy1 < labelAt[1]) labelAt = [vx1 - pad, vy1 - pad];
        }
        if (labelAt && c.username) {
          ctx.save();
          ctx.globalAlpha = 0.9;
          ctx.font = "600 11px Nunito, system-ui, sans-serif";
          ctx.fillStyle = color;
          ctx.textBaseline = "bottom";
          ctx.fillText(c.username, labelAt[0], labelAt[1] - 3, 160);
          ctx.restore();
        }
      }

      // laser trails
      for (const [id, pts] of trails) {
        while (pts.length && now - pts[0].t > LASER_FADE_MS) pts.shift();
        if (!pts.length) {
          trails.delete(id);
          continue;
        }
        animating = true;
        ctx.save();
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.shadowColor = LASER_COLOR;
        ctx.shadowBlur = 8;
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1];
          const b = pts[i];
          if (b.t - a.t > 250) continue; // separate strokes
          const life = 1 - (now - b.t) / LASER_FADE_MS;
          const [ax, ay] = sceneToViewport(a.x, a.y, appState);
          const [bx, by] = sceneToViewport(b.x, b.y, appState);
          ctx.globalAlpha = Math.max(0, life);
          ctx.strokeStyle = LASER_COLOR;
          ctx.lineWidth = 1.5 + 3.5 * life;
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
          ctx.stroke();
        }
        ctx.restore();
      }

      // cursors
      const k = 1 - Math.exp(-dt / 45);
      for (const [id, cur] of cursors) {
        if (!cur.visible) continue;
        const ddx = cur.x - cur.dx;
        const ddy = cur.y - cur.dy;
        if (Math.abs(ddx) + Math.abs(ddy) > 0.05 / appState.zoom) {
          cur.dx += ddx * k;
          cur.dy += ddy * k;
          animating = true;
        } else {
          cur.dx = cur.x;
          cur.dy = cur.y;
        }
        const c = collaborators[id];
        const color = c?.color || colorForId(id);
        let [vx, vy] = sceneToViewport(cur.dx, cur.dy, appState);
        const offscreen = vx < 0 || vy < 0 || vx > width || vy > height;
        vx = Math.min(Math.max(vx, 4), width - 24);
        vy = Math.min(Math.max(vy, 4), height - 30);
        ctx.save();
        ctx.globalAlpha = offscreen ? 0.55 : 1;
        if (cur.tool === "laser") {
          ctx.beginPath();
          ctx.arc(vx, vy, 4, 0, Math.PI * 2);
          ctx.fillStyle = LASER_COLOR;
          ctx.shadowColor = LASER_COLOR;
          ctx.shadowBlur = 10;
          ctx.fill();
          ctx.shadowBlur = 0;
        } else {
          ctx.translate(vx, vy);
          ctx.fillStyle = color;
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 1.5;
          ctx.stroke(CURSOR_PATH);
          ctx.fill(CURSOR_PATH);
          ctx.translate(-vx, -vy);
        }
        const name = c?.username;
        if (name) {
          nameTag(ctx, vx + 12, vy + 18, name, color);
          if (c?.isSpeaking) {
            ctx.beginPath();
            ctx.arc(vx + 8, vy + 28, 3, 0, Math.PI * 2);
            ctx.fillStyle = "#2f9e44";
            ctx.fill();
          }
        }
        ctx.restore();
      }
      return animating;
    };

    const frame = (now: number) => {
      const dt = Math.min(100, now - last);
      last = now;
      if (draw(dt, now)) raf = requestAnimationFrame(frame);
      else running = false;
    };
    function kick() {
      if (running) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }

    resize();
    window.addEventListener("resize", resize);
    const offDirty = onOverlayDirty(kick);
    const offStore = useStore.subscribe((s, p) => {
      const a = s.appState;
      const b = p.appState;
      if (
        s.elements !== p.elements ||
        a.collaborators !== b.collaborators ||
        a.scrollX !== b.scrollX ||
        a.scrollY !== b.scrollY ||
        a.zoom !== b.zoom
      )
        kick();
    });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      offDirty();
      offStore();
    };
  }, []);

  return <canvas ref={ref} className="cb-overlay" aria-hidden="true" />;
}
