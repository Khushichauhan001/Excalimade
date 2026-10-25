import type { BinaryFiles, ExcalidrawElement, TextElement } from "../core/types";
import { getSelectedElements, getState, showToast } from "../core/store";
import { duplicateElements, newEmbeddable, newText } from "../core/elements";
import { getCommonBounds } from "../core/geometry";
import { getPasteHandlers } from "../core/events";
import { viewportToScene } from "../core/utils";
import { session } from "./session";
import { insertImages } from "./images";
import { toEmbedUrl } from "./embeds";
import { deleteSelectionImpl } from "./commands";

const CLIPBOARD_TYPE = "excalidraw/clipboard";

/** Selection plus bound labels and frame children, in z-order. */
export function getCopyableElements(): ExcalidrawElement[] {
  const s = getState();
  const selected = new Set(getSelectedElements(s).map((e) => e.id));
  return s.elements.filter(
    (e) =>
      !e.isDeleted &&
      (selected.has(e.id) ||
        (e.type === "text" && (e as TextElement).containerId && selected.has((e as TextElement).containerId!)) ||
        (e.frameId && selected.has(e.frameId))),
  );
}

export function serializeClipboard(elements: ExcalidrawElement[]) {
  const files: BinaryFiles = {};
  const all = getState().files;
  for (const e of elements) if (e.type === "image" && all[(e as any).fileId]) files[(e as any).fileId] = all[(e as any).fileId];
  return JSON.stringify({ type: CLIPBOARD_TYPE, elements, files });
}

export async function copyToClipboard(cut = false) {
  const els = getCopyableElements();
  if (!els.length) return;
  const json = serializeClipboard(els);
  try {
    await navigator.clipboard.writeText(json);
  } catch {
    fallbackCopy(json);
  }
  if (cut) deleteSelectionImpl();
}

function fallbackCopy(text: string) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  ta.remove();
}

/** Paste position: last pointer position on the canvas, or the viewport centre. */
function pastePoint() {
  const as = getState().appState;
  return session.lastPointer ?? viewportToScene(as.width / 2, as.height / 2, as);
}

export async function handlePasteData(data: { text: string; html: string; files: File[] }) {
  for (const h of getPasteHandlers()) if (await h(data)) return;
  const s = getState();
  if (s.appState.viewModeEnabled) return;

  // 1. Excalidraw elements
  const text = data.text.trim();
  if (text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text);
      if ((parsed.type === CLIPBOARD_TYPE || parsed.type === "excalidraw") && Array.isArray(parsed.elements)) {
        if (parsed.files) s.addFiles(Object.values(parsed.files));
        pasteElements(parsed.elements.filter((e: ExcalidrawElement) => !e.isDeleted));
        return;
      }
    } catch {
      /* not JSON — fall through */
    }
  }
  // 2. images
  const images = data.files.filter((f) => f.type.startsWith("image/"));
  if (images.length) {
    const as = s.appState;
    const p = pastePoint();
    await insertImages(images, { x: (p[0] + as.scrollX) * as.zoom, y: (p[1] + as.scrollY) * as.zoom });
    return;
  }
  if (!text) return;
  // 3. embeddable links
  if (/^https?:\/\/\S+$/.test(text)) {
    const embed = toEmbedUrl(text);
    if (embed && embed.kind !== "generic") {
      const [x, y] = pastePoint();
      const w = embed.width, h = embed.height;
      const el = newEmbeddable({ link: text, x: x - w / 2, y: y - h / 2, width: w, height: h });
      s.recordHistory();
      s.setElements([...s.elements, el]);
      s.setAppState({ selectedElementIds: { [el.id]: true } });
      return;
    }
  }
  // 4. plain text → text element (links keep a hyperlink)
  const [x, y] = pastePoint();
  const t = newText({ text, x, y });
  const el = { ...t, x: x - t.width / 2, y: y - t.height / 2, link: /^https?:\/\/\S+$/.test(text) ? text : null };
  s.recordHistory();
  s.setElements([...s.elements, el]);
  s.setAppState({ selectedElementIds: { [el.id]: true }, activeTool: "selection" });
}

export function pasteElements(elements: ExcalidrawElement[]) {
  if (!elements.length) return;
  const s = getState();
  const [x1, y1, x2, y2] = getCommonBounds(elements);
  const [px, py] = pastePoint();
  const dup = duplicateElements(elements, [px - (x1 + x2) / 2, py - (y1 + y2) / 2]);
  s.recordHistory();
  s.setElements([...s.elements, ...dup]);
  const sel: Record<string, true> = {};
  for (const e of dup) if (!(e.type === "text" && (e as TextElement).containerId) && !(e.frameId && dup.some((d) => d.id === e.frameId))) sel[e.id] = true;
  s.setAppState({ selectedElementIds: sel, activeTool: "selection" });
}

/** Paste via the async Clipboard API (context menu / command palette). */
export async function pasteFromSystemClipboard() {
  try {
    const items = await navigator.clipboard.read();
    const files: File[] = [];
    let text = "";
    let html = "";
    for (const item of items) {
      for (const type of item.types) {
        const blob = await item.getType(type);
        if (type.startsWith("image/")) files.push(new File([blob], "pasted", { type }));
        else if (type === "text/plain") text = await blob.text();
        else if (type === "text/html") html = await blob.text();
      }
    }
    await handlePasteData({ text, html, files });
  } catch {
    try {
      await handlePasteData({ text: await navigator.clipboard.readText(), html: "", files: [] });
    } catch {
      showToast("Clipboard access denied — use Ctrl/⌘+V instead", "error");
    }
  }
}
