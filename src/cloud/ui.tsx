// Shared UI primitives for the cloud module (dialog shell, avatars, menus, icons, helpers).
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useDevice } from "../core/useDevice";
import { showToast } from "../core/store";

// ---- icons (20px, stroke, currentColor) ---------------------------------------------------------

const svg = (d: ReactNode, size = 20) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);
export const Icon = {
  close: (s?: number) => svg(<path d="M18 6 6 18M6 6l12 12" />, s),
  cloud: (s?: number) => svg(<path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 8.5a4 4 0 0 1-.5 9.5H7Z" />, s),
  cloudCheck: (s?: number) => svg(<><path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 8.5a4 4 0 0 1-.5 9.5H7Z" /><path d="m9.5 13 2 2 3.5-3.5" /></>, s),
  cloudOff: (s?: number) => svg(<><path d="M7 18a4.5 4.5 0 0 1-.6-8.96M10 6.3A6 6 0 0 1 18 8.5a4 4 0 0 1 1.9 7.4M17.5 18H7" /><path d="m3 3 18 18" /></>, s),
  comment: (s?: number) => svg(<path d="M21 11.5a8.4 8.4 0 0 1-9 8.3 9 9 0 0 1-3.6-.8L3 20.5l1.5-4.6A8 8 0 0 1 3 11.5 8.5 8.5 0 0 1 12 3a8.5 8.5 0 0 1 9 8.5Z" />, s),
  history: (s?: number) => svg(<><path d="M3 12a9 9 0 1 0 2.6-6.4L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></>, s),
  share: (s?: number) => svg(<><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" /></>, s),
  grid: (s?: number) => svg(<><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>, s),
  folder: (s?: number) => svg(<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />, s),
  trash: (s?: number) => svg(<><path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></>, s),
  plus: (s?: number) => svg(<path d="M12 5v14M5 12h14" />, s),
  search: (s?: number) => svg(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>, s),
  more: (s?: number) => svg(<><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>, s),
  users: (s?: number) => svg(<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5" /></>, s),
  settings: (s?: number) => svg(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></>, s),
  link: (s?: number) => svg(<><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></>, s),
  lock: (s?: number) => svg(<><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>, s),
  globe: (s?: number) => svg(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>, s),
  check: (s?: number) => svg(<path d="m5 12 5 5 9-10" />, s),
  copy: (s?: number) => svg(<><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></>, s),
  bell: (s?: number) => svg(<><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" /></>, s),
  chevronDown: (s?: number) => svg(<path d="m6 9 6 6 6-6" />, s),
  back: (s?: number) => svg(<path d="M19 12H5M12 19l-7-7 7-7" />, s),
  restore: (s?: number) => svg(<><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></>, s),
  edit: (s?: number) => svg(<><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></>, s),
  eye: (s?: number) => svg(<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>, s),
  code: (s?: number) => svg(<path d="m16 18 6-6-6-6M8 6l-6 6 6 6" />, s),
  logout: (s?: number) => svg(<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></>, s),
  send: (s?: number) => svg(<path d="M22 2 11 13M22 2l-7 20-4-9-9-4Z" />, s),
  menu: (s?: number) => svg(<path d="M4 6h16M4 12h16M4 18h16" />, s),
  bookmark: (s?: number) => svg(<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z" />, s),
  copyScene: (s?: number) => svg(<><rect x="8" y="8" width="13" height="13" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>, s),
  move: (s?: number) => svg(<><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" /><path d="m12 11 3 3-3 3M9 14h6" /></>, s),
  open: (s?: number) => svg(<><path d="M14 3h7v7M21 3l-9 9" /><path d="M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5" /></>, s),
};

// ---- helpers -----------------------------------------------------------------------------------

export function timeAgo(ts: number) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return d === 1 ? "yesterday" : `${d} days ago`;
  return new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short", year: d > 300 ? "numeric" : undefined });
}

export const formatDate = (ts: number) =>
  new Date(ts).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("") || "?";

export async function copyText(text: string, label = "Link copied") {
  try {
    await navigator.clipboard.writeText(text);
    showToast(label, "success");
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    showToast(ok ? label : "Couldn't copy — select and copy it manually", ok ? "success" : "error");
  }
}

export const formatBytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

// ---- components ----------------------------------------------------------------------------------

export function Avatar({ user, size = 28, title }: { user: { name: string; color: string } | null; size?: number; title?: string }) {
  const name = user?.name ?? "Deleted user";
  return (
    <span
      className="cl-avatar"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4), background: user?.color ?? "#868e96" }}
      title={title ?? name}
      aria-label={name}
    >
      {initials(name)}
    </span>
  );
}

export function Spinner({ size = 18 }: { size?: number }) {
  return <span className="cl-spinner" style={{ width: size, height: size }} aria-label="Loading" />;
}

/** Modal dialog shell; full-screen sheet on phones. Escape / backdrop click closes. */
export function ClDialog(props: {
  title: ReactNode;
  onClose: () => void;
  size?: "small" | "regular" | "wide" | "full";
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  hideHeader?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(props.onClose);
  onCloseRef.current = props.onClose;
  const { isMobile } = useDevice();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("[data-autofocus], input:not([type=hidden]):not([disabled])");
    (first ?? ref.current)?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // only the top-most cloud dialog handles Escape
      const dialogs = document.querySelectorAll(".cl-dialog");
      if (dialogs[dialogs.length - 1] !== ref.current) return;
      e.stopPropagation();
      e.preventDefault();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      if (prev && document.contains(prev)) prev.focus?.({ preventScroll: true });
    };
  }, []);
  return createPortal(
    <div
      className={`cl-overlay ${isMobile ? "cl-overlay--mobile" : ""}`}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div
        ref={ref}
        className={`cl-dialog cl-dialog--${isMobile ? "full" : props.size ?? "regular"} ${props.className ?? ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={typeof props.title === "string" ? props.title : undefined}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key !== "Escape") e.stopPropagation();
        }}
      >
        {!props.hideHeader && (
          <header className="cl-dialog__header">
            <h2 className="cl-dialog__title">{props.title}</h2>
            <button className="cl-icon-btn" onClick={props.onClose} aria-label="Close" title="Close">
              {Icon.close()}
            </button>
          </header>
        )}
        <div className="cl-dialog__body">{props.children}</div>
        {props.footer && <footer className="cl-dialog__footer">{props.footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  hidden?: boolean;
}

/** Button that opens a small popover menu. */
export function MenuButton({ items, label, children, className, align = "end" }: { items: MenuItem[]; label: string; children: ReactNode; className?: string; align?: "start" | "end" }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const mw = menu.current?.offsetWidth ?? 200;
    const mh = menu.current?.offsetHeight ?? 200;
    let left = align === "end" ? r.right - mw : r.left;
    left = Math.max(8, Math.min(window.innerWidth - mw - 8, left));
    let top = r.bottom + 4;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 4);
    setPos({ top, left });
  }, [open, align]);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (menu.current?.contains(e.target as Node) || btn.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", () => setOpen(false), { once: true });
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
  const visible = items.filter((i) => !i.hidden);
  return (
    <>
      <button
        ref={btn}
        className={className ?? "cl-icon-btn"}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        {children}
      </button>
      {open &&
        createPortal(
          <div ref={menu} className="cl-menu" role="menu" style={pos ? { top: pos.top, left: pos.left } : { visibility: "hidden", top: 0, left: 0 }}>
            {visible.map((item) => (
              <button
                key={item.label}
                role="menuitem"
                className={`cl-menu__item ${item.danger ? "cl-menu__item--danger" : ""}`}
                disabled={item.disabled}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {item.icon && <span className="cl-menu__icon">{item.icon}</span>}
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

export function CopyField({ value, label, copyLabel = "Copy", multiline }: { value: string; label?: string; copyLabel?: string; multiline?: boolean }) {
  return (
    <div className={`cl-copy ${multiline ? "cl-copy--multi" : ""}`}>
      {multiline ? (
        <textarea className="cl-input cl-copy__input" readOnly value={value} rows={3} onFocus={(e) => e.currentTarget.select()} aria-label={label} />
      ) : (
        <input className="cl-input cl-copy__input" readOnly value={value} onFocus={(e) => e.currentTarget.select()} aria-label={label} />
      )}
      <button className="cl-btn cl-btn--primary" onClick={() => void copyText(value, label ? `${label} copied` : "Copied")}>
        {Icon.copy(16)} {copyLabel}
      </button>
    </div>
  );
}

export const ROLE_LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", member: "Member", viewer: "Viewer" };
export const ROLE_HINT: Record<string, string> = {
  owner: "Full control, including deleting the workspace",
  admin: "Manage members, invites and all scenes",
  member: "Create and edit scenes",
  viewer: "View workspace scenes only",
};
