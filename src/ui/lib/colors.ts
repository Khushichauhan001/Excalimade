// Excalidraw's open-color based palette.
export const TRANSPARENT = "transparent";

/** Five shades (light → dark) per hue. */
export const SHADES: Record<string, string[]> = {
  gray: ["#f8f9fa", "#e9ecef", "#ced4da", "#868e96", "#343a40"],
  bronze: ["#f8f1ee", "#eaddd7", "#d2bab0", "#a18072", "#846358"],
  red: ["#fff5f5", "#ffc9c9", "#ff8787", "#fa5252", "#e03131"],
  pink: ["#fff0f6", "#fcc2d7", "#f783ac", "#e64980", "#c2255c"],
  grape: ["#f8f0fc", "#eebefa", "#da77f2", "#be4bdb", "#9c36b5"],
  violet: ["#f3f0ff", "#d0bfff", "#9775fa", "#7950f2", "#6741d9"],
  blue: ["#e7f5ff", "#a5d8ff", "#4dabf7", "#228be6", "#1971c2"],
  cyan: ["#e3fafc", "#99e9f2", "#3bc9db", "#15aabf", "#0c8599"],
  teal: ["#e6fcf5", "#96f2d7", "#38d9a9", "#12b886", "#099268"],
  green: ["#ebfbee", "#b2f2bb", "#69db7c", "#40c057", "#2f9e44"],
  yellow: ["#fff9db", "#ffec99", "#ffd43b", "#fab005", "#f08c00"],
  orange: ["#fff4e6", "#ffd8a8", "#ffa94d", "#fd7e14", "#e8590c"],
};

export const BLACK = "#1e1e1e";
export const WHITE = "#ffffff";

const HUES = ["red", "pink", "grape", "violet", "blue", "cyan", "teal", "green", "yellow", "orange"];

export type PaletteKind = "stroke" | "background" | "canvas";

/** Quick-pick swatches shown inline in the properties panel. */
export const QUICK_STROKE = [BLACK, "#e03131", "#2f9e44", "#1971c2", "#f08c00"];
export const QUICK_BACKGROUND = [TRANSPARENT, "#ffc9c9", "#b2f2bb", "#a5d8ff", "#ffec99"];
export const CANVAS_LIGHT = ["#ffffff", "#f8f9fa", "#f5faff", "#fffce8", "#fdf8f6"];
export const CANVAS_DARK = ["#121212", "#161718", "#13171c", "#181605", "#1b1615"];

/** Named entries in the full palette grid (15 cells = 3 rows of 5). */
export interface PaletteEntry {
  name: string;
  color: string;
  hue?: string;
}

export function paletteGrid(kind: PaletteKind): PaletteEntry[] {
  const idx = kind === "stroke" ? 4 : kind === "background" ? 1 : 0;
  return [
    { name: "Transparent", color: TRANSPARENT },
    { name: "White", color: WHITE },
    { name: "Gray", color: SHADES.gray[idx], hue: "gray" },
    { name: "Black", color: BLACK },
    { name: "Bronze", color: SHADES.bronze[idx], hue: "bronze" },
    ...HUES.map((h) => ({ name: h[0].toUpperCase() + h.slice(1), color: SHADES[h][idx], hue: h })),
  ];
}

/** Hue whose shade list contains this color, if any. */
export function findHue(color: string | null | undefined): string | null {
  if (!color) return null;
  const c = color.toLowerCase();
  for (const [hue, list] of Object.entries(SHADES)) if (list.includes(c)) return hue;
  return null;
}

export function isValidColor(v: string) {
  const s = v.trim();
  if (!s) return false;
  if (/^#?([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) return true;
  return typeof CSS !== "undefined" && CSS.supports("color", s);
}

export function normalizeColor(v: string) {
  const s = v.trim();
  if (/^([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) return `#${s.toLowerCase()}`;
  return s.startsWith("#") ? s.toLowerCase() : s;
}

/** Perceived brightness, to choose a readable check-mark color over a swatch. */
export function isDarkColor(color: string) {
  if (color === TRANSPARENT) return false;
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})/i.exec(color);
  if (!m) return false;
  let hex = m[1];
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  const n = parseInt(hex, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return r * 0.299 + g * 0.587 + b * 0.114 < 140;
}
