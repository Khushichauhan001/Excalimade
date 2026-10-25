// Scene data embedded in SVG <metadata>, in excalidraw.com's format:
// <!-- payload-type:application/vnd.excalidraw+json --><!-- payload-version:2 --><!-- payload-start -->BASE64<!-- payload-end -->
import { EXCALIDRAW_MIME, encodeEnvelope, decodePayload, byteStringToBytes } from "./encode";
import { base64ToBytes } from "../core/utils";

/** Envelope JSON (a byte string) → base64. */
export async function encodeSvgPayload(sceneJson: string) {
  return btoa(await encodeEnvelope(sceneJson));
}

/** Add <metadata> with the scene to an SVG element (mutates it). */
export async function embedSceneInSvg(svg: SVGSVGElement, sceneJson: string) {
  const doc = svg.ownerDocument;
  svg.querySelectorAll("metadata[data-excalimade]").forEach((m) => m.remove());
  const meta = doc.createElementNS("http://www.w3.org/2000/svg", "metadata");
  meta.setAttribute("data-excalimade", "");
  meta.append(
    doc.createComment(`payload-type:${EXCALIDRAW_MIME}`),
    doc.createComment("payload-version:2"),
    doc.createComment("payload-start"),
    doc.createTextNode(await encodeSvgPayload(sceneJson)),
    doc.createComment("payload-end"),
  );
  svg.insertBefore(meta, svg.firstChild);
  svg.insertBefore(doc.createComment("svg-source:excalidraw"), svg.firstChild);
}

export const svgHasScene = (text: string) => text.includes(`payload-type:${EXCALIDRAW_MIME}`);

/** Returns embedded scene JSON text, or null. */
export async function extractSceneFromSvg(text: string): Promise<string | null> {
  if (!svgHasScene(text)) return null;
  const m = text.match(/<!--\s*payload-start\s*-->\s*([\s\S]+?)\s*<!--\s*payload-end\s*-->/);
  if (!m) return null;
  const version = text.match(/<!--\s*payload-version:(\d+)\s*-->/)?.[1] ?? "1";
  const b64 = m[1].replace(/\s+/g, "");
  if (version === "1") return new TextDecoder().decode(base64ToBytes(b64)); // legacy: base64 of UTF-8 JSON
  // v2: base64 of the envelope JSON byte string
  const envelope = atob(b64);
  try {
    return await decodePayload(envelope);
  } catch {
    return decodePayload(new TextDecoder().decode(byteStringToBytes(envelope)));
  }
}
