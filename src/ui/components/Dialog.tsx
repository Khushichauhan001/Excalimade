import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icons } from "../icons";
import { pushEscape } from "../lib/escape";
import { focusables, focusInitial, trapTab } from "../lib/focus";

export interface DialogProps {
  title: ReactNode;
  onClose(): void;
  /** small ≈ 420px, regular ≈ 600px (default), wide ≈ 960px. Full-screen sheet on phones. */
  size?: "small" | "regular" | "wide";
  children: ReactNode;
  /** Optional footer row (buttons), right-aligned. */
  footer?: ReactNode;
}

/**
 * Modal dialog: overlay, title bar with close button, Esc / overlay click to close,
 * focus trap and focus restore. Put `data-autofocus` on the element that should get focus first.
 */
export function Dialog({ title, onClose, size = "regular", children, footer }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const pop = pushEscape(() => closeRef.current());
    const node = ref.current;
    if (node) {
      const body = node.querySelector<HTMLElement>(".ui-dialog__body");
      if (node.querySelector("[data-autofocus]") || !body) focusInitial(node);
      else {
        const first = focusables(body)[0];
        (first ?? node).focus({ preventScroll: true });
      }
    }
    return () => {
      pop();
      if (prev && document.contains(prev) && (node?.contains(document.activeElement) || document.activeElement === document.body)) {
        prev.focus?.({ preventScroll: true });
      }
    };
  }, []);

  return createPortal(
    <div
      className="ui-dialog-overlay"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) closeRef.current();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`ui-dialog ui-dialog--${size}`}
        onKeyDown={(e) => trapTab(e, ref.current)}
      >
        <header className="ui-dialog__header">
          <h2 id={titleId} className="ui-dialog__title">
            {title}
          </h2>
          <button type="button" className="ui-dialog__close" aria-label="Close" title="Close (Esc)" onClick={() => closeRef.current()}>
            {Icons.close}
          </button>
        </header>
        <div className="ui-dialog__body">{children}</div>
        {footer && <footer className="ui-dialog__footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
