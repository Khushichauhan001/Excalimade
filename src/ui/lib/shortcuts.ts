import { eventToShortcut, formatShortcut } from "../../core/actions";

const KEY_GLYPHS: Record<string, string> = {
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  Escape: "Esc",
  Delete: "Del",
  Backspace: "⌫",
  Enter: "↵",
};

/** Human label for a shortcut ("Mod+Shift+ArrowLeft" → "Ctrl+Shift+←" / "⌘⇧←"). */
export function prettyShortcut(sc: string) {
  let out = formatShortcut(sc);
  for (const [k, g] of Object.entries(KEY_GLYPHS)) out = out.replace(new RegExp(`\\b${k}\\b`), g);
  return out;
}

/** Shortcut split into key-cap chips. */
export function shortcutKeys(sc: string): string[] {
  const s = prettyShortcut(sc);
  if (!s.includes("+") || s === "+") return [s];
  return s.split(/\+(?=.)/);
}

const CODE_KEYS: Record<string, string> = {
  BracketLeft: "[",
  BracketRight: "]",
  Slash: "/",
  Quote: "'",
  Equal: "=",
  Minus: "-",
  Comma: ",",
  Period: ".",
  Semicolon: ";",
  Backslash: "\\",
  Backquote: "`",
};

/**
 * All shortcut strings an event may correspond to: the canonical `eventToShortcut` form plus a
 * physical-key form for punctuation (so "Mod+Shift+[" and macOS "Alt+/" match on any layout).
 */
export function eventShortcutCandidates(e: KeyboardEvent): string[] {
  const out = [eventToShortcut(e)];
  const k = CODE_KEYS[e.code];
  if (k) {
    const parts: string[] = [];
    if (e.metaKey || e.ctrlKey) parts.push("Mod");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");
    const alt = [...parts, k].join("+");
    if (!out.includes(alt)) out.push(alt);
  }
  return out;
}
