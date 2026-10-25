// Central action registry. Every module registers its commands here so the
// command palette, keyboard shortcut handler, menus and context menu share one source of truth.
import type { Store } from "./store";

export type ActionCategory =
  | "tools"
  | "editor"
  | "element"
  | "arrange"
  | "view"
  | "export"
  | "library"
  | "generate"
  | "collab"
  | "help";

export interface Action {
  id: string;
  label: string;
  category: ActionCategory;
  /** Extra words for command-palette fuzzy search. */
  keywords?: string[];
  /**
   * Keyboard shortcut(s) in a normalised form: modifiers in the order
   * "Mod+Alt+Shift+" followed by the key (e.g. "Mod+Shift+Z", "Alt+Shift+D", "Delete", "?", "1").
   * "Mod" = Cmd on macOS, Ctrl elsewhere. Single-key shortcuts are matched on `event.key` (lower-cased letter).
   */
  shortcuts?: string[];
  /** Small emoji / glyph or inline SVG path data for menus (optional). */
  icon?: string;
  /** Whether the action is available in the current state (hidden/disabled otherwise). */
  predicate?: (s: Store) => boolean;
  perform: (s: Store, source: "keyboard" | "ui" | "palette" | "contextMenu") => void;
  /** Show in the canvas context menu when something is selected / nothing is selected. */
  contextMenu?: "element" | "canvas" | "both";
  /** Visible in the command palette (default true). */
  palette?: boolean;
}

const registry = new Map<string, Action>();
const listeners = new Set<() => void>();

export const registerActions = (actions: Action[]) => {
  for (const a of actions) registry.set(a.id, a);
  listeners.forEach((l) => l());
};

export const getActions = () => [...registry.values()];
export const getAction = (id: string) => registry.get(id);

export const subscribeActions = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** Normalise a KeyboardEvent to the shortcut string format used above. */
export const eventToShortcut = (e: KeyboardEvent) => {
  let key = e.key === " " ? "Space" : e.key;
  // physical key for letters/digits so Alt (macOS) and Shift+digit still map predictably
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code) && (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey)) key = e.code.slice(5);
  else if (key.length === 1) key = key.toUpperCase();
  const isSymbol = key.length === 1 && !/[A-Z0-9]/.test(key); // "?", "+", "-", … already shifted
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push("Mod");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey && !isSymbol) parts.push("Shift");
  return [...parts, key].join("+");
};

/** Pretty label for a shortcut ("Mod+Shift+Z" → "Ctrl+Shift+Z" / "⌘⇧Z"). */
export const formatShortcut = (sc: string) => {
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  return mac
    ? sc.replace("Mod+", "⌘").replace("Alt+", "⌥").replace("Shift+", "⇧")
    : sc.replace("Mod", "Ctrl");
};
