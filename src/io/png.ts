// PNG chunk read/write (no deps): CRC32, tEXt/iTXt encode & decode, chunk insertion before IEND.
import { EXCALIDRAW_MIME, encodeEnvelope, decodePayload, inflate } from "./encode";

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

let CRC_TABLE: Uint32Array | null = null;
export function crc32(bytes: Uint8Array, start = 0, end = bytes.length) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = start; i < end; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export interface PngChunk {
  type: string;
  data: Uint8Array;
}

export const isPng = (bytes: Uint8Array) => SIGNATURE.every((b, i) => bytes[i] === b);

export function readChunks(bytes: Uint8Array): PngChunk[] {
  if (!isPng(bytes)) throw new Error("Not a PNG file");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: PngChunk[] = [];
  let off = 8;
  while (off + 12 <= bytes.length) {
    const len = view.getUint32(off);
    const type = String.fromCharCode(...bytes.subarray(off + 4, off + 8));
    if (off + 12 + len > bytes.length) throw new Error("Truncated PNG");
    chunks.push({ type, data: bytes.subarray(off + 8, off + 8 + len) });
    off += 12 + len;
    if (type === "IEND") break;
  }
  return chunks;
}

export function writeChunks(chunks: PngChunk[]): Uint8Array {
  const total = 8 + chunks.reduce((n, c) => n + 12 + c.data.length, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  out.set(SIGNATURE, 0);
  let off = 8;
  for (const c of chunks) {
    view.setUint32(off, c.data.length);
    for (let i = 0; i < 4; i++) out[off + 4 + i] = c.type.charCodeAt(i);
    out.set(c.data, off + 8);
    view.setUint32(off + 8 + c.data.length, crc32(out, off + 4, off + 8 + c.data.length));
    off += 12 + c.data.length;
  }
  return out;
}

/** tEXt: keyword \0 text, both Latin-1. */
export function encodeTextChunk(keyword: string, text: string): PngChunk {
  const data = new Uint8Array(keyword.length + 1 + text.length);
  for (let i = 0; i < keyword.length; i++) data[i] = keyword.charCodeAt(i) & 0xff;
  data[keyword.length] = 0;
  for (let i = 0; i < text.length; i++) data[keyword.length + 1 + i] = text.charCodeAt(i) & 0xff;
  return { type: "tEXt", data };
}

const latin1 = (b: Uint8Array) => {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return s;
};

/** Decode a tEXt or iTXt chunk → { keyword, text } (iTXt may be zlib-compressed and is UTF-8). */
export async function decodeTextChunk(chunk: PngChunk): Promise<{ keyword: string; text: string } | null> {
  const d = chunk.data;
  const z = d.indexOf(0);
  if (z < 0) return null;
  const keyword = latin1(d.subarray(0, z));
  if (chunk.type === "tEXt") return { keyword, text: latin1(d.subarray(z + 1)) };
  if (chunk.type === "iTXt") {
    const compressed = d[z + 1] === 1;
    let p = z + 3; // skip compression flag + method
    const langEnd = d.indexOf(0, p);
    if (langEnd < 0) return null;
    const transEnd = d.indexOf(0, langEnd + 1);
    if (transEnd < 0) return null;
    p = transEnd + 1;
    const body = d.subarray(p);
    const text = compressed ? await inflate(body) : new TextDecoder().decode(body);
    return { keyword, text };
  }
  return null;
}

/** Insert (or replace) the scene metadata chunk before IEND. */
export async function embedSceneInPng(png: Uint8Array, sceneJson: string): Promise<Uint8Array> {
  const chunks = readChunks(png).filter(
    (c) => !((c.type === "tEXt" || c.type === "iTXt") && latin1(c.data.subarray(0, EXCALIDRAW_MIME.length)) === EXCALIDRAW_MIME),
  );
  const meta = encodeTextChunk(EXCALIDRAW_MIME, await encodeEnvelope(sceneJson));
  const iend = chunks.findIndex((c) => c.type === "IEND");
  chunks.splice(iend < 0 ? chunks.length : iend, 0, meta);
  return writeChunks(chunks);
}

/** Returns the embedded scene JSON text, or null if the PNG has none. */
export async function extractSceneFromPng(png: Uint8Array): Promise<string | null> {
  if (!isPng(png)) return null;
  for (const c of readChunks(png)) {
    if (c.type !== "tEXt" && c.type !== "iTXt") continue;
    const t = await decodeTextChunk(c);
    if (t && t.keyword === EXCALIDRAW_MIME) return decodePayload(t.text);
  }
  return null;
}
