// Minimal dialog shell for the io/library module (full-screen sheet on phones) + promise-based prompts.
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CloseIcon } from "./icons";

export function IoDialog(props: {
  title: ReactNode;
  onClose: () => void;
  size?: "small" | "regular" | "wide";
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("[autofocus], input, button:not(.io-dialog__close)");
    (first ?? ref.current)?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        props.onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      prev?.focus?.({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return createPortal(
    <div
      className="io-overlay"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div
        ref={ref}
        className={`io-dialog io-dialog--${props.size ?? "regular"} ${props.className ?? ""}`}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <header className="io-dialog__header">
          <h2 className="io-dialog__title">{props.title}</h2>
          <button className="io-icon-btn io-dialog__close" onClick={props.onClose} aria-label="Close" title="Close">
            <CloseIcon />
          </button>
        </header>
        <div className="io-dialog__body">{props.children}</div>
        {props.footer && <footer className="io-dialog__footer">{props.footer}</footer>}
      </div>
    </div>,
    document.querySelector(".app") ?? document.body,
  );
}

// ---- promise-based prompts ------------------------------------------------------------------

export interface ChoiceOption {
  id: string;
  label: string;
  kind?: "primary" | "danger" | "default";
}
interface Prompt {
  title: string;
  message: ReactNode;
  options: ChoiceOption[];
  resolve: (id: string | null) => void;
}

let current: Prompt | null = null;
const queue: Prompt[] = [];
const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());

/** Ask the user to pick one option. Resolves to the option id, or null when dismissed. */
export function choose(title: string, message: ReactNode, options: ChoiceOption[]): Promise<string | null> {
  return new Promise((resolve) => {
    const p: Prompt = { title, message, options, resolve };
    if (current) queue.push(p);
    else current = p;
    notify();
  });
}

export async function confirmDialog(opts: {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}): Promise<boolean> {
  const r = await choose(opts.title, opts.message, [
    { id: "cancel", label: opts.cancelLabel ?? "Cancel" },
    { id: "ok", label: opts.confirmLabel ?? "Confirm", kind: opts.danger ? "danger" : "primary" },
  ]);
  return r === "ok";
}

const settle = (id: string | null) => {
  const p = current;
  current = queue.shift() ?? null;
  notify();
  p?.resolve(id);
};

export function PromptHost() {
  const prompt = useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => current,
  );
  if (!prompt) return null;
  return (
    <IoDialog
      key={prompt.title + String(prompt.options.length)}
      title={prompt.title}
      size="small"
      onClose={() => settle(null)}
      footer={prompt.options.map((o, i) => (
        <button
          key={o.id}
          className={`io-btn ${o.kind === "primary" ? "io-btn--primary" : o.kind === "danger" ? "io-btn--danger" : ""}`}
          autoFocus={i === prompt.options.length - 1}
          onClick={() => settle(o.id)}
        >
          {o.label}
        </button>
      ))}
    >
      <div className="io-prompt__message">{prompt.message}</div>
    </IoDialog>
  );
}
