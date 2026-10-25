// Payload encoding shared by PNG/SVG embedding. Uses excalidraw.com's envelope so images exported here
// open on excalidraw.com and vice versa:
//   { version: "1", encoding: "bstring", compressed: true, encoded: "<zlib-deflated UTF-8 as a byte string>" }
import { base64ToBytes, bytesToBase64, gunzip } from "../core/utils";

export const EXCALIDRAW_MIME = "application/vnd.excalidraw+json";
export const EXCALIDRAW_LIB_MIME = "application/vnd.excalidrawlib+json";

async function streamBytes(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export const deflate = (text: string) => streamBytes(new TextEncoder().encode(text), new CompressionStream("deflate"));
export const inflate = async (bytes: Uint8Array) =>
  new TextDecoder().decode(await streamBytes(bytes, new DecompressionStream("deflate")));

/** Bytes → "binary string" (one char per byte, 0–255). */
export const bytesToByteString = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return s;
};
export const byteStringToBytes = (s: string) => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
};

export interface EncodedEnvelope {
  version: string;
  encoding: "bstring";
  compressed: boolean;
  encoded: string;
}

/** Text → JSON envelope string (all chars are in 0–255 so it can live in a PNG tEXt chunk). */
export async function encodeEnvelope(text: string): Promise<string> {
  const env: EncodedEnvelope = {
    version: "1",
    encoding: "bstring",
    compressed: true,
    encoded: bytesToByteString(await deflate(text)),
  };
  return JSON.stringify(env);
}

/**
 * Decode any payload we know: excalidraw's envelope (compressed or not), a gzip+base64 string,
 * or plain scene JSON. Returns the scene JSON text.
 */
export async function decodePayload(payload: string): Promise<string> {
  const trimmed = payload.trim();
  if (trimmed.startsWith("{")) {
    const obj = JSON.parse(trimmed);
    if (obj && typeof obj.encoded === "string") {
      if (obj.encoding && obj.encoding !== "bstring") throw new Error(`Unsupported encoding ${obj.encoding}`);
      const bytes = byteStringToBytes(obj.encoded);
      return obj.compressed ? inflate(bytes) : new TextDecoder().decode(bytes);
    }
    return trimmed; // already a scene
  }
  // base64 of gzip / deflate / utf-8 text
  const bytes = base64ToBytes(trimmed.replace(/\s+/g, ""));
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) return gunzip(bytes);
  if (bytes[0] === 0x78) return inflate(bytes);
  return new TextDecoder().decode(bytes);
}

export { bytesToBase64, base64ToBytes };
