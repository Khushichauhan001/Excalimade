// Font registry + text measurement. Font ids follow Excalidraw's numbering so
// .excalidraw files from excalidraw.com open with the right fonts.
import type { FontFamily } from "./types";

export interface FontDef {
  id: FontFamily;
  name: string;
  css: string; // CSS font-family stack
  category: "hand-drawn" | "normal" | "code";
}

export const FONTS: FontDef[] = [
  { id: 5, name: "Excalifont", css: "Excalifont, Xiaolai, Virgil, Segoe UI Emoji", category: "hand-drawn" },
  { id: 6, name: "Nunito", css: "Nunito, Segoe UI Emoji", category: "normal" },
  { id: 8, name: "Comic Shanns", css: "'Comic Shanns', Segoe UI Emoji", category: "code" },
  { id: 1, name: "Virgil", css: "Virgil, Segoe UI Emoji", category: "hand-drawn" },
  { id: 2, name: "Helvetica", css: "Helvetica, Arial, sans-serif, Segoe UI Emoji", category: "normal" },
  { id: 3, name: "Cascadia", css: "Cascadia, 'Cascadia Code', monospace, Segoe UI Emoji", category: "code" },
  { id: 7, name: "Lilita One", css: "'Lilita One', Segoe UI Emoji", category: "normal" },
  { id: 9, name: "Liberation Sans", css: "'Liberation Sans', Arial, sans-serif", category: "normal" },
  { id: 10, name: "Georgia (serif)", css: "Georgia, 'Times New Roman', serif", category: "normal" },
  { id: 11, name: "System UI", css: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", category: "normal" },
  { id: 12, name: "Courier", css: "'Courier New', Courier, monospace", category: "code" },
];

/** The three quick-pick fonts shown in the properties panel. */
export const QUICK_FONTS: FontFamily[] = [5, 6, 8];

export const getFontCss = (id: FontFamily) => (FONTS.find((f) => f.id === id) ?? FONTS[0]).css;

export const getFontString = (fontSize: number, fontFamily: FontFamily) =>
  `${fontSize}px ${getFontCss(fontFamily)}`;

let measureCtx: CanvasRenderingContext2D | null = null;
const ctx = () => {
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d")!;
  return measureCtx;
};

export const measureLine = (line: string, font: string) => {
  const c = ctx();
  c.font = font;
  return c.measureText(line).width;
};

export function measureText(text: string, fontSize: number, fontFamily: FontFamily, lineHeight = 1.25) {
  const font = getFontString(fontSize, fontFamily);
  const lines = text.split("\n");
  const width = Math.max(...lines.map((l) => measureLine(l, font)), fontSize * 0.1);
  return { width: Math.ceil(width), height: Math.ceil(lines.length * fontSize * lineHeight) };
}

/** Word-wrap text to a max width (used for text inside containers). */
export function wrapText(text: string, fontSize: number, fontFamily: FontFamily, maxWidth: number) {
  const font = getFontString(fontSize, fontFamily);
  const out: string[] = [];
  for (const para of text.split("\n")) {
    const words = para.split(/(\s+)/);
    let line = "";
    for (const w of words) {
      const candidate = line + w;
      if (measureLine(candidate, font) <= maxWidth || !line) {
        // break a single over-long word into characters
        if (!line && measureLine(w, font) > maxWidth) {
          let chunk = "";
          for (const ch of w) {
            if (measureLine(chunk + ch, font) > maxWidth && chunk) {
              out.push(chunk);
              chunk = ch;
            } else chunk += ch;
          }
          line = chunk;
        } else line = candidate;
      } else {
        out.push(line.trimEnd());
        line = w.trimStart();
      }
    }
    out.push(line.trimEnd());
  }
  return out.join("\n");
}

/** Resolves once the bundled web fonts are ready so measurements are correct. */
export async function loadFonts() {
  const loads = ["Excalifont", "Virgil", "Nunito", "'Comic Shanns'", "Cascadia", "'Lilita One'"].map((f) =>
    document.fonts.load(`20px ${f}`).catch(() => []),
  );
  await Promise.all(loads);
}
