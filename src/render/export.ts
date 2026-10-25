import { RoughCanvas } from "roughjs/bin/canvas";
import { RoughSVG } from "roughjs/bin/svg";
import type {
  BinaryFiles,
  ExcalidrawElement,
  FrameElement,
  FreeDrawElement,
  ImageElement,
  TextElement,
} from "../core/types";
import { getCommonBounds, getElementAbsCoords, type Bounds } from "../core/geometry";
import { getFontCss } from "../core/text";
import { getState } from "../core/store";
import { drawElements } from "./scene";
import { DARK_FILTER, getFreeDrawPath } from "./renderElement";
import { getDrawables, isTransparent } from "./rough";
import { preloadImages } from "./images";

export interface ExportOptions {
  files: BinaryFiles;
  exportBackground: boolean;
  viewBackgroundColor: string;
  exportDarkMode: boolean;
  /** 1, 2 or 3 */
  scale: number;
  padding?: number;
  /** When exporting frames: clip content to the frame and omit the frame outline/name. */
  frameId?: string;
}

function resolveFrame(elements: readonly ExcalidrawElement[], frameId?: string) {
  if (!frameId) return undefined;
  return (elements.find((e) => e.id === frameId) ?? getState().elements.find((e) => e.id === frameId)) as FrameElement | undefined;
}

function exportBounds(elements: readonly ExcalidrawElement[], frame: FrameElement | undefined, padding: number): Bounds {
  if (frame) return [frame.x, frame.y, frame.x + frame.width, frame.y + frame.height];
  const [a, b, c, d] = getCommonBounds(elements);
  return [a - padding, b - padding, c + padding, d + padding];
}

const visible = (elements: readonly ExcalidrawElement[], frame?: FrameElement) =>
  elements.filter((e) => !e.isDeleted && !(frame && e.id === frame.id));

/** Render elements to a new canvas (PNG export, clipboard, thumbnails, PDF pages, wireframe-to-code). */
export async function exportToCanvas(elements: readonly ExcalidrawElement[], opts: ExportOptions): Promise<HTMLCanvasElement> {
  const frame = resolveFrame(elements, opts.frameId);
  const els = visible(elements, frame).filter((e) => e.type !== "frame" || !frame);
  const padding = frame ? 0 : opts.padding ?? 10;
  const [minX, minY, maxX, maxY] = exportBounds(els, frame, padding);
  const scale = opts.scale || 1;
  const width = Math.max(1, Math.ceil((maxX - minX) * scale));
  const height = Math.max(1, Math.ceil((maxY - minY) * scale));
  await preloadImages(els.filter((e) => e.type === "image").map((e) => (e as ImageElement).fileId), opts.files);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  if (opts.exportBackground) {
    ctx.fillStyle = opts.viewBackgroundColor;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.scale(scale, scale);
  ctx.translate(-minX, -minY);
  drawElements(
    ctx,
    new RoughCanvas(canvas),
    els,
    { files: opts.files, canvasBg: opts.viewBackgroundColor, darkMode: opts.exportDarkMode, isExport: true },
    { frameChrome: false, clipFrame: frame },
  );
  if (!opts.exportDarkMode) return canvas;
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const octx = out.getContext("2d")!;
  octx.filter = DARK_FILTER;
  octx.drawImage(canvas, 0, 0);
  return out;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const fontFileFor: Record<number, string[]> = {
  5: ["/fonts/Excalifont-Latin.woff2", "/fonts/Excalifont-LatinExt.woff2"],
  1: ["/fonts/Virgil-Regular.woff2"],
  6: ["/fonts/Nunito-Regular.woff2"],
  8: ["/fonts/ComicShanns-Regular.woff2"],
  3: ["/fonts/CascadiaCode-Regular.woff2"],
  7: ["/fonts/LilitaOne-Regular.woff2"],
};
const fontFaceName: Record<number, string> = { 5: "Excalifont", 1: "Virgil", 6: "Nunito", 8: "Comic Shanns", 3: "Cascadia", 7: "Lilita One" };
const fontDataCache = new Map<string, Promise<string>>();
const fetchFontData = (url: string) => {
  if (!fontDataCache.has(url)) {
    fontDataCache.set(
      url,
      fetch(url)
        .then((r) => r.blob())
        .then((b) => new Promise<string>((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result as string); fr.readAsDataURL(b); }))
        .catch(() => ""),
    );
  }
  return fontDataCache.get(url)!;
};

async function fontFaceCss(elements: readonly ExcalidrawElement[]) {
  const used = new Set(elements.filter((e) => e.type === "text").map((e) => (e as TextElement).fontFamily));
  let css = "";
  for (const id of used) {
    for (const url of fontFileFor[id] ?? []) {
      const data = await fetchFontData(url);
      if (data) css += `@font-face{font-family:"${fontFaceName[id]}";src:url(${data}) format("woff2");}`;
    }
  }
  return css;
}

/** Render elements to an SVG element (fonts embedded inline so the file is self-contained). */
export async function exportToSvg(elements: readonly ExcalidrawElement[], opts: ExportOptions): Promise<SVGSVGElement> {
  const frame = resolveFrame(elements, opts.frameId);
  const els = visible(elements, frame).filter((e) => e.type !== "frame");
  const padding = frame ? 0 : opts.padding ?? 10;
  const [minX, minY, maxX, maxY] = exportBounds(els, frame, padding);
  const width = maxX - minX, height = maxY - minY;
  const scale = opts.scale || 1;

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("xmlns", SVG_NS);
  svg.setAttribute("version", "1.1");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", String(width * scale));
  svg.setAttribute("height", String(height * scale));
  if (opts.exportDarkMode) svg.setAttribute("filter", "url(#_dark)");

  const defs = document.createElementNS(SVG_NS, "defs");
  const style = document.createElementNS(SVG_NS, "style");
  style.textContent = await fontFaceCss(els);
  defs.appendChild(style);
  svg.appendChild(defs);
  if (opts.exportDarkMode) {
    // invert(93%) hue-rotate(180deg) as an SVG filter (works in all viewers, unlike CSS filters)
    defs.insertAdjacentHTML(
      "beforeend",
      `<filter id="_dark" color-interpolation-filters="sRGB"><feComponentTransfer><feFuncR type="linear" slope="-0.93" intercept="0.93"/><feFuncG type="linear" slope="-0.93" intercept="0.93"/><feFuncB type="linear" slope="-0.93" intercept="0.93"/></feComponentTransfer><feColorMatrix type="hueRotate" values="180"/></filter>`,
    );
  }

  if (opts.exportBackground) {
    const bg = document.createElementNS(SVG_NS, "rect");
    bg.setAttribute("x", "0");
    bg.setAttribute("y", "0");
    bg.setAttribute("width", String(width));
    bg.setAttribute("height", String(height));
    bg.setAttribute("fill", opts.viewBackgroundColor);
    svg.appendChild(bg);
  }

  const root = document.createElementNS(SVG_NS, "g");
  root.setAttribute("transform", `translate(${-minX} ${-minY})`);
  svg.appendChild(root);
  const rs = new RoughSVG(svg);

  // clip paths for frames
  const frames = new Map<string, FrameElement>();
  for (const e of elements) if (e.type === "frame" && !e.isDeleted) frames.set(e.id, e as FrameElement);
  if (frame) frames.set(frame.id, frame);
  for (const f of frames.values()) {
    defs.insertAdjacentHTML(
      "beforeend",
      `<clipPath id="clip-${f.id}"><rect x="${f.x}" y="${f.y}" width="${f.width}" height="${f.height}"/></clipPath>`,
    );
  }

  for (const el of els) {
    const node = elementToSvg(el, rs, opts);
    if (!node) continue;
    const clipId = frame ? frame.id : el.frameId && frames.has(el.frameId) ? el.frameId : null;
    if (clipId) {
      const g = document.createElementNS(SVG_NS, "g");
      g.setAttribute("clip-path", `url(#clip-${clipId})`);
      g.appendChild(node);
      root.appendChild(g);
    } else root.appendChild(node);
  }
  return svg;
}

function elementToSvg(el: ExcalidrawElement, rs: RoughSVG, opts: ExportOptions): SVGElement | null {
  const g = document.createElementNS(SVG_NS, "g");
  const [x1, y1, x2, y2] = getElementAbsCoords(el);
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
  const deg = (el.angle * 180) / Math.PI;
  g.setAttribute("transform", `translate(${cx} ${cy}) rotate(${deg}) translate(${el.x - cx} ${el.y - cy})`);
  if (el.opacity !== 100) g.setAttribute("opacity", String(el.opacity / 100));
  switch (el.type) {
    case "text": {
      const t = el as TextElement;
      const lineH = t.fontSize * t.lineHeight;
      const anchor = t.textAlign === "center" ? "middle" : t.textAlign === "right" ? "end" : "start";
      const x = t.textAlign === "center" ? t.width / 2 : t.textAlign === "right" ? t.width : 0;
      t.text.split("\n").forEach((line, i) => {
        const text = document.createElementNS(SVG_NS, "text");
        text.setAttribute("x", String(x));
        text.setAttribute("y", String((i + 0.5) * lineH));
        text.setAttribute("font-family", getFontCss(t.fontFamily));
        text.setAttribute("font-size", `${t.fontSize}px`);
        text.setAttribute("fill", t.strokeColor);
        text.setAttribute("text-anchor", anchor);
        text.setAttribute("dominant-baseline", "central");
        text.setAttribute("style", "white-space: pre;");
        text.textContent = line;
        g.appendChild(text);
      });
      return g;
    }
    case "freedraw": {
      const fd = el as FreeDrawElement;
      const p = document.createElementNS(SVG_NS, "path");
      p.setAttribute("d", getFreeDrawPath(fd));
      p.setAttribute("fill", fd.strokeColor);
      g.appendChild(p);
      return g;
    }
    case "image": {
      const im = el as ImageElement;
      const file = opts.files[im.fileId];
      if (!file) return null;
      const inner = document.createElementNS(SVG_NS, "svg");
      const c = im.crop;
      inner.setAttribute("width", String(im.width));
      inner.setAttribute("height", String(im.height));
      inner.setAttribute("preserveAspectRatio", "none");
      const image = document.createElementNS(SVG_NS, "image");
      image.setAttribute("href", file.dataURL);
      if (c) {
        inner.setAttribute("viewBox", `${c.x} ${c.y} ${c.width} ${c.height}`);
        image.setAttribute("width", String(c.naturalWidth));
        image.setAttribute("height", String(c.naturalHeight));
      } else {
        image.setAttribute("width", String(im.width));
        image.setAttribute("height", String(im.height));
        image.setAttribute("preserveAspectRatio", "none");
      }
      if (im.scale[0] < 0 || im.scale[1] < 0) {
        const fg = document.createElementNS(SVG_NS, "g");
        fg.setAttribute("transform", `translate(${im.scale[0] < 0 ? im.width : 0} ${im.scale[1] < 0 ? im.height : 0}) scale(${im.scale[0]} ${im.scale[1]})`);
        inner.appendChild(image);
        fg.appendChild(inner);
        g.appendChild(fg);
      } else {
        inner.appendChild(image);
        g.appendChild(inner);
      }
      if (opts.exportDarkMode) g.setAttribute("filter", "url(#_dark)"); // double-invert keeps photos natural
      return g;
    }
    case "embeddable": {
      const r = document.createElementNS(SVG_NS, "rect");
      r.setAttribute("width", String(el.width));
      r.setAttribute("height", String(el.height));
      r.setAttribute("rx", "8");
      r.setAttribute("fill", "#f6f6f9");
      r.setAttribute("stroke", isTransparent(el.strokeColor) ? "#ccc" : el.strokeColor);
      g.appendChild(r);
      const a = document.createElementNS(SVG_NS, "a");
      a.setAttribute("href", el.link ?? "#");
      const t = document.createElementNS(SVG_NS, "text");
      t.setAttribute("x", String(el.width / 2));
      t.setAttribute("y", String(el.height / 2));
      t.setAttribute("text-anchor", "middle");
      t.setAttribute("font-family", "Nunito, sans-serif");
      t.setAttribute("font-size", "16px");
      t.setAttribute("fill", "#6965db");
      t.textContent = el.customData?.html ? "Generated HTML" : (el.link ?? "");
      a.appendChild(t);
      g.appendChild(a);
      return g;
    }
    case "frame":
      return null;
    default:
      for (const d of getDrawables(el, opts.viewBackgroundColor).shapes) g.appendChild(rs.draw(d));
      if (el.link && /^https?:/.test(el.link)) {
        const a = document.createElementNS(SVG_NS, "a");
        a.setAttribute("href", el.link);
        a.appendChild(g);
        return a;
      }
      return g;
  }
}

