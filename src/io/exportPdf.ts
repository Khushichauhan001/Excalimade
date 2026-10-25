// Export frames (or the whole scene) as a multi-page PDF. Loaded on demand.
import { getState, getNonDeletedElements, showToast } from "../core/store";
import type { ExcalidrawElement } from "../core/types";
import { exportToCanvas } from "../render/export";
import { buildPdf, fitPageSize, type PdfPage } from "./pdf";
import { saveBlob } from "./fileio";
import { canvasToBlob } from "./exportImage";
import { getOrderedFrames } from "./frames";

export async function exportPdf() {
  const { appState, files } = getState();
  const all = getNonDeletedElements();
  if (!all.length) return showToast("Nothing to export — the canvas is empty.", "info");
  const frames = getOrderedFrames();
  const jobs: { elements: ExcalidrawElement[]; frameId?: string }[] = frames.length
    ? frames.map((f) => ({ elements: all.filter((e) => e.id === f.id || e.frameId === f.id), frameId: f.id }))
    : [{ elements: all }];
  showToast(`Exporting ${jobs.length} page${jobs.length === 1 ? "" : "s"}…`, "info");
  try {
    const pages: PdfPage[] = [];
    const bg = appState.viewBackgroundColor && appState.viewBackgroundColor !== "transparent" ? appState.viewBackgroundColor : "#ffffff";
    for (const job of jobs) {
      const canvas = await exportToCanvas(job.elements, {
        files,
        exportBackground: true,
        viewBackgroundColor: bg,
        exportDarkMode: false,
        scale: 2,
        padding: job.frameId ? 0 : 20,
        frameId: job.frameId,
      });
      // JPEG has no alpha: flatten on the background colour
      const flat = document.createElement("canvas");
      flat.width = canvas.width;
      flat.height = canvas.height;
      const ctx = flat.getContext("2d")!;
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, flat.width, flat.height);
      ctx.drawImage(canvas, 0, 0);
      const jpeg = new Uint8Array(await (await canvasToBlob(flat, "image/jpeg", 0.92)).arrayBuffer());
      pages.push({ jpeg, width: flat.width, height: flat.height, ...fitPageSize(flat.width, flat.height) });
    }
    const pdf = buildPdf(pages, appState.name);
    const r = await saveBlob(new Blob([pdf as BlobPart], { type: "application/pdf" }), {
      name: appState.name || "Untitled",
      extension: ".pdf",
      mimeType: "application/pdf",
      description: "PDF document",
    });
    if (r !== "cancelled") showToast("PDF exported", "success");
  } catch (e) {
    console.error(e);
    showToast("Couldn't export the PDF.", "error");
  }
}
