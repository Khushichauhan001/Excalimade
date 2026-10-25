// ENGINE CONTRACT — imperative entry points into the canvas engine. Signatures are stable.
import { insertImages } from "./images";
import { copyToClipboard, pasteFromSystemClipboard } from "./clipboard";
import { deleteSelectionImpl, followLinkImpl, startTextEditingImpl } from "./commands";

/** Insert image files (downscaled + stored as WebP). Placed at a client point, or the viewport centre. */
export async function insertImageFiles(files: File[], clientPoint?: { x: number; y: number }): Promise<void> {
  await insertImages(files, clientPoint);
}
/** Copy selected elements to the system clipboard (as Excalidraw clipboard JSON). */
export async function copySelection(): Promise<void> {
  await copyToClipboard(false);
}
export async function cutSelection(): Promise<void> {
  await copyToClipboard(true);
}
/** Paste from the system clipboard (runs registered paste handlers first). */
export async function pasteFromClipboard(): Promise<void> {
  await pasteFromSystemClipboard();
}
/** Soft-delete the selected elements (and their bound text / frame children), with history. */
export function deleteSelection(): void {
  deleteSelectionImpl();
}
/** Open the inline text editor for a text element or a container (creates its label if missing). */
export function startTextEditing(elementId: string): void {
  startTextEditingImpl(elementId);
}
/** Navigate an element link: external URLs open in a new tab, "#element=<id>" scrolls to the element. */
export function followLink(link: string): void {
  followLinkImpl(link);
}
