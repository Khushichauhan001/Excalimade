import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { pushEscape } from "../lib/escape";
import { focusInitial, trapTab } from "../lib/focus";

export interface PopoverProps {
  /** Element the popover is positioned against (usually the toggle button). */
  anchor: HTMLElement | null;
  onClose(): void;
  placement?: "bottom" | "top" | "right" | "left";
  align?: "start" | "center" | "end";
  offset?: number;
  className?: string;
  ariaLabel?: string;
  role?: "dialog" | "menu" | "listbox";
  /** Move focus into the popover on open (default true). */
  autoFocus?: boolean;
  children: ReactNode;
}

const MARGIN = 8;

/**
 * Floating island anchored to an element. Rendered in a portal, flips when there is no room,
 * stays inside the viewport, closes on outside pointer-down and Escape, returns focus on close.
 */
export function Popover({
  anchor,
  onClose,
  placement = "bottom",
  align = "start",
  offset = 8,
  className,
  ariaLabel,
  role = "dialog",
  autoFocus = true,
  children,
}: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !anchor) return;
    const place = () => {
      const a = anchor.getBoundingClientRect();
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let side = placement;
      if (side === "bottom" && a.bottom + offset + h > vh - MARGIN && a.top - offset - h > MARGIN) side = "top";
      else if (side === "top" && a.top - offset - h < MARGIN && a.bottom + offset + h < vh - MARGIN) side = "bottom";
      else if (side === "right" && a.right + offset + w > vw - MARGIN && a.left - offset - w > MARGIN) side = "left";
      else if (side === "left" && a.left - offset - w < MARGIN) side = "right";
      let x: number;
      let y: number;
      if (side === "bottom" || side === "top") {
        y = side === "bottom" ? a.bottom + offset : a.top - offset - h;
        x = align === "start" ? a.left : align === "end" ? a.right - w : a.left + a.width / 2 - w / 2;
      } else {
        x = side === "right" ? a.right + offset : a.left - offset - w;
        y = align === "start" ? a.top : align === "end" ? a.bottom - h : a.top + a.height / 2 - h / 2;
      }
      x = Math.max(MARGIN, Math.min(x, vw - w - MARGIN));
      y = Math.max(MARGIN, Math.min(y, vh - h - MARGIN));
      setPos((p) => (p && p.x === x && p.y === y ? p : { x, y }));
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor, placement, align, offset]);

  useEffect(() => {
    const popEsc = pushEscape(() => closeRef.current());
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor?.contains(t)) return;
      // clicks inside a nested popover (portalled) shouldn't close the parent
      if ((t as HTMLElement).closest?.(".ui-popover")) return;
      closeRef.current();
    };
    document.addEventListener("pointerdown", onDown, true);
    const prevFocus = document.activeElement as HTMLElement | null;
    const node = ref.current;
    if (autoFocus && node) focusInitial(node);
    return () => {
      popEsc();
      document.removeEventListener("pointerdown", onDown, true);
      if (node?.contains(document.activeElement) || document.activeElement === document.body) {
        (anchor ?? prevFocus)?.focus?.({ preventScroll: true });
      }
    };
  }, [anchor]);

  return createPortal(
    <div
      ref={ref}
      role={role}
      aria-label={ariaLabel}
      tabIndex={-1}
      className={`ui-popover ui-island ${className ?? ""}`}
      style={{ left: pos?.x ?? -9999, top: pos?.y ?? -9999, visibility: pos ? "visible" : "hidden" }}
      onKeyDown={(e) => trapTab(e, ref.current)}
    >
      {children}
    </div>,
    document.body,
  );
}
