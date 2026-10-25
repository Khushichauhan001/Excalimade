import type { KeyboardEvent, ReactNode } from "react";
import { prettyShortcut } from "../lib/shortcuts";

/** Arrow-key / Home / End navigation between [role^=menuitem] descendants. Attach to the menu container. */
export function menuKeyDown(e: KeyboardEvent<HTMLElement>) {
  const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
  if (!keys.includes(e.key)) return;
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])')];
  if (!items.length) return;
  e.preventDefault();
  e.stopPropagation();
  const cur = items.indexOf(document.activeElement as HTMLElement);
  let next = 0;
  if (e.key === "ArrowDown") next = cur < 0 ? 0 : (cur + 1) % items.length;
  else if (e.key === "ArrowUp") next = cur < 0 ? items.length - 1 : (cur - 1 + items.length) % items.length;
  else if (e.key === "End") next = items.length - 1;
  items[next].focus();
}

export interface MenuItemProps {
  icon?: ReactNode;
  label: ReactNode;
  /** Shortcut in registry format ("Mod+Shift+E"); rendered as a hint. */
  shortcut?: string;
  onSelect(): void;
  danger?: boolean;
  disabled?: boolean;
  /** Renders as a checkbox item with a check mark. */
  checked?: boolean;
  /** Extra content on the right (e.g. a badge). */
  trailing?: ReactNode;
}

export function MenuItem({ icon, label, shortcut, onSelect, danger, disabled, checked, trailing }: MenuItemProps) {
  return (
    <button
      type="button"
      role={checked === undefined ? "menuitem" : "menuitemcheckbox"}
      aria-checked={checked}
      disabled={disabled}
      className={`ui-menu-item ${danger ? "is-danger" : ""} ${checked ? "is-checked" : ""}`}
      onClick={onSelect}
    >
      <span className="ui-menu-item__icon">{icon}</span>
      <span className="ui-menu-item__label">{label}</span>
      {trailing}
      {shortcut && <span className="ui-menu-item__shortcut">{prettyShortcut(shortcut)}</span>}
    </button>
  );
}

export const MenuSeparator = () => <div className="ui-menu-sep" role="separator" />;

export const MenuHeading = ({ children }: { children: ReactNode }) => (
  <div className="ui-menu-heading" role="presentation">
    {children}
  </div>
);
