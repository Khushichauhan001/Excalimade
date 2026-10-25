import { useEffect, useRef, useState } from "react";
import { useStore } from "../core/store";
import { isInputTarget } from "../core/utils";
import { getOrderedFrames } from "./frames";
import { didEnterFullscreen, fitSlide, nextSlide, prevSlide, stopPresentation } from "./presentation";
import { ChevronLeft, ChevronRight, ExitIcon, LaserIcon } from "./icons";

export function PresenterControls() {
  const mode = useStore((s) => s.appState.presentationMode);
  const laser = useStore((s) => s.appState.activeTool === "laser");
  const frameCount = useStore((s) => (s.appState.presentationMode ? getOrderedFrames(s.elements.filter((e) => !e.isDeleted)).length : 0));
  const width = useStore((s) => s.appState.width);
  const height = useStore((s) => s.appState.height);
  const [idle, setIdle] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const active = !!mode;

  // keyboard + swipe + idle-fade while presenting
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (isInputTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const handled = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      switch (e.key) {
        case "ArrowRight":
        case "ArrowDown":
        case "PageDown":
        case " ":
        case "Enter":
          handled();
          nextSlide();
          break;
        case "ArrowLeft":
        case "ArrowUp":
        case "PageUp":
        case "Backspace":
          handled();
          prevSlide();
          break;
        case "Home":
          handled();
          useStore.getState().setAppState({ presentationMode: { frameIndex: 0 } });
          fitSlide(0);
          break;
        case "End": {
          handled();
          const last = getOrderedFrames().length - 1;
          useStore.getState().setAppState({ presentationMode: { frameIndex: last } });
          fitSlide(last);
          break;
        }
        case "Escape":
          handled();
          stopPresentation();
          break;
        case "l":
        case "L":
          handled();
          toggleLaser();
          break;
      }
    };
    let touch: { x: number; y: number; t: number } | null = null;
    const onTouchStart = (e: TouchEvent) => {
      touch = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() } : null;
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (!touch || useStore.getState().appState.activeTool === "laser") return;
      const t = e.changedTouches[0];
      const dx = t.clientX - touch.x;
      const dy = t.clientY - touch.y;
      if (Date.now() - touch.t < 600 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        if (dx < 0) nextSlide();
        else prevSlide();
      }
      touch = null;
    };
    const wake = () => {
      setIdle(false);
      clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(() => setIdle(true), 2500);
    };
    const onFs = () => {
      if (!document.fullscreenElement && didEnterFullscreen()) stopPresentation();
    };
    wake();
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("pointermove", wake);
    window.addEventListener("pointerdown", wake);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      clearTimeout(idleTimer.current);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("pointermove", wake);
      window.removeEventListener("pointerdown", wake);
      document.removeEventListener("fullscreenchange", onFs);
    };
  }, [active]);

  // refit the current slide when the canvas is resized (entering fullscreen, rotation)
  useEffect(() => {
    if (active) fitSlide(useStore.getState().appState.presentationMode!.frameIndex, false);
  }, [active, width, height]);

  // frames deleted by a collaborator mid-presentation
  useEffect(() => {
    if (active && frameCount === 0) stopPresentation();
    else if (active && mode!.frameIndex >= frameCount) prevSlide();
  }, [active, frameCount, mode]);

  if (!mode) return null;
  const i = mode.frameIndex;
  return (
    <div className={`io-presenter ${idle ? "io-presenter--idle" : ""}`} role="toolbar" aria-label="Presentation controls">
      <button className="io-icon-btn" onClick={prevSlide} disabled={i <= 0} title="Previous slide (←)" aria-label="Previous slide">
        <ChevronLeft />
      </button>
      <span className="io-presenter__count" aria-live="polite">
        {i + 1} / {frameCount}
      </span>
      <button className="io-icon-btn" onClick={nextSlide} disabled={i >= frameCount - 1} title="Next slide (→)" aria-label="Next slide">
        <ChevronRight />
      </button>
      <span className="io-presenter__sep" />
      <button
        className={`io-icon-btn ${laser ? "io-icon-btn--active" : ""}`}
        onClick={toggleLaser}
        title="Laser pointer (L)"
        aria-label="Laser pointer"
        aria-pressed={laser}
      >
        <LaserIcon />
      </button>
      <button className="io-icon-btn" onClick={stopPresentation} title="Exit presentation (Esc)" aria-label="Exit presentation">
        <ExitIcon />
      </button>
    </div>
  );
}

function toggleLaser() {
  const s = useStore.getState();
  s.setAppState({ activeTool: s.appState.activeTool === "laser" ? "selection" : "laser" });
}
