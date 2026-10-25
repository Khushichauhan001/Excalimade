// PNG / SVG export (with optional embedded scene) and clipboard copy.
import { getState, getNonDeletedElements, showToast } from "../core/store";
import type { ExcalidrawElement } from "../core/types";
import { exportToCanvas, exportToSvg, type ExportOptions } from "../render/export";
import { serializeScene } from "./serialize";
import { embedSceneInPng } from "./png";
import { embedSceneInSvg } from "./svgEmbed";
import { saveBlob } from "./fileio";

export interface ImageExportSettings {
  background: boolean;
  darkMode: boolean;
  embedScene: boolean;
  onlySelected: boolean;
  scale: number;
  padding: number;
}

export const defaultExportSettings = (): ImageExportSettings => ({
  background: true,
  darkMode: getState().appState.theme === "dark",
  embedScene: false,
  onlySelected: Object.keys(getState().appState.selectedElementIds).length > 0,
  scale: 2,
  padding: 10,
});

/** Elements to export + frame clipping when exactly one frame is the selection. */
export function getExportTarget(onlySelected: boolean): { elements: ExcalidrawElement[]; frameId?: string } {
  const all = getNonDeletedElements();
  const sel = getState().appState.selectedElementIds;
  if (!onlySelected || !Object.keys(sel).length) return { elements: all };
  const ids = new Set(Object.keys(sel));
  const selected = all.filter((e) => ids.has(e.id));
  const frames = selected.filter((e) => e.type === "frame");
  // include labels of selected containers and children of selected frames
  for (const el of all) {
    if (el.type === "text" && el.containerId && ids.has(el.containerId)) ids.add(el.id);
    if (el.frameId && ids.has(el.frameId)) ids.add(el.id);
  }
  const elements = all.filter((e) => ids.has(e.id));
  if (frames.length === 1 && selected.length === 1) return { elements, frameId: frames[0].id };
  return { elements };
}

export const exportOptions = (s: ImageExportSettings, frameId?: string): ExportOptions => {
  const { files, appState } = getState();
  return {
    files,
    exportBackground: s.background,
    viewBackgroundColor: appState.viewBackgroundColor,
    exportDarkMode: s.darkMode,
    scale: s.scale,
    padding: s.padding,
    frameId,
  };
};

const canvasToBlob = (c: HTMLCanvasElement, type = "image/png", quality?: number) =>
  new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("Canvas is too large to export"))), type, quality));

export async function renderPngBlob(s: ImageExportSettings): Promise<Blob> {
  const { elements, frameId } = getExportTarget(s.onlySelected);
  const canvas = await exportToCanvas(elements, exportOptions(s, frameId));
  const blob = await canvasToBlob(canvas);
  if (!s.embedScene) return blob;
  const withScene = await embedSceneInPng(new Uint8Array(await blob.arrayBuffer()), serializeScene({ elements }));
  return new Blob([withScene as BlobPart], { type: "image/png" });
}

export async function renderSvgText(s: ImageExportSettings): Promise<string> {
  const { elements, frameId } = getExportTarget(s.onlySelected);
  const svg = await exportToSvg(elements, exportOptions(s, frameId));
  if (s.embedScene) await embedSceneInSvg(svg, serializeScene({ elements }));
  return new XMLSerializer().serializeToString(svg);
}

const exportName = () => getState().appState.name || "Untitled";

export async function savePng(s: ImageExportSettings, name = exportName()) {
  const blob = await renderPngBlob(s);
  const r = await saveBlob(blob, { name, extension: ".png", mimeType: "image/png", description: "PNG image" });
  if (r !== "cancelled") showToast("Image exported", "success");
}

export async function saveSvg(s: ImageExportSettings, name = exportName()) {
  const text = await renderSvgText(s);
  const blob = new Blob([text], { type: "image/svg+xml" });
  const r = await saveBlob(blob, { name, extension: ".svg", mimeType: "image/svg+xml", description: "SVG image" });
  if (r !== "cancelled") showToast("Image exported", "success");
}

export async function copyPng(s: ImageExportSettings) {
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
    showToast("Your browser can't copy images — use Export instead.", "error");
    return;
  }
  // pass a promise so Safari keeps the user-activation for the async render
  await navigator.clipboard.write([new ClipboardItem({ "image/png": renderPngBlob(s) })]);
  showToast("Copied to clipboard as PNG", "success");
}

export async function copySvg(s: ImageExportSettings) {
  const text = await renderSvgText(s);
  await navigator.clipboard.writeText(text);
  showToast("Copied to clipboard as SVG", "success");
}

/** Quick copy (context menu / shortcut): selection if any, else the whole scene. */
export async function quickCopy(kind: "png" | "svg") {
  if (!getNonDeletedElements().length) return showToast("Nothing to copy — the canvas is empty.", "info");
  const s = { ...defaultExportSettings(), scale: kind === "png" ? 2 : 1 };
  try {
    await (kind === "png" ? copyPng(s) : copySvg(s));
  } catch (e) {
    console.error(e);
    showToast("Couldn't copy to the clipboard.", "error");
  }
}

export { canvasToBlob };
