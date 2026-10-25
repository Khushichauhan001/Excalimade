// Minimal Excalidraw-style dialog shell for the collab module (overlay, island, Esc to close, phone sheet).
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useDevice } from "../core/useDevice";
import { IconClose } from "./icons";

export function CbDialog({
  title,
  onClose,
  size = "regular",
  children,
  footer,
}: {
  title: ReactNode;
  onClose: () => void;
  size?: "small" | "regular" | "wide";
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { isMobile } = useDevice();
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey, true);
      prev?.focus?.();
    };
  }, [onClose]);

  return createPortal(
    <div
      className={`cb-dialog-overlay${isMobile ? " cb-dialog-overlay--sheet" : ""}`}
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={ref}
        className={`cb-dialog cb-dialog--${size}${isMobile ? " cb-dialog--sheet" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div className="cb-dialog__header">
          <h2 id={titleId} className="cb-dialog__title">
            {title}
          </h2>
          <button className="cb-icon-btn" onClick={onClose} aria-label="Close" title="Close">
            <IconClose />
          </button>
        </div>
        <div className="cb-dialog__body">{children}</div>
        {footer && <div className="cb-dialog__footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
