// End-to-end encryption helpers (AES-GCM 128 via Web Crypto). Keys only ever live in URL fragments.
import { base64ToBytes, bytesToBase64, gunzip, gzip } from "../core/utils";

export interface EncryptedPayload {
  iv: string; // base64, 12 bytes
  data: string; // base64 ciphertext (+ GCM tag)
  z?: 1; // plaintext was gzipped
}

const ab = (u: Uint8Array) => u as Uint8Array<ArrayBuffer>;

export const toBase64Url = (bytes: Uint8Array) =>
  bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const fromBase64Url = (s: string) =>
  base64ToBytes(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));

export const ROOM_ID_RE = /^[a-f0-9]{20,40}$/;
export const ROOM_KEY_RE = /^[A-Za-z0-9_-]{22}$/;
export const SHARE_ID_RE = /^[a-f0-9]{20}$/;

const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));

export const generateRoomId = () =>
  Array.from(randomBytes(10), (b) => b.toString(16).padStart(2, "0")).join("");

export async function generateKey(): Promise<string> {
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 128 }, true, ["encrypt", "decrypt"]);
  return toBase64Url(new Uint8Array(await crypto.subtle.exportKey("raw", key)));
}

export async function importKey(key: string): Promise<CryptoKey> {
  if (!ROOM_KEY_RE.test(key)) throw new Error("Invalid encryption key");
  return crypto.subtle.importKey("raw", ab(fromBase64Url(key)), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/** Encrypt bytes → iv (12) || ciphertext. */
export async function encryptBytes(key: CryptoKey, bytes: Uint8Array): Promise<Uint8Array> {
  const iv = randomBytes(12);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, ab(bytes)));
  const out = new Uint8Array(12 + cipher.length);
  out.set(iv, 0);
  out.set(cipher, 12);
  return out;
}

export async function decryptBytes(key: CryptoKey, blob: Uint8Array): Promise<Uint8Array> {
  if (blob.length < 29) throw new Error("Corrupt data");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: ab(blob.subarray(0, 12)) }, key, ab(blob.subarray(12)));
  return new Uint8Array(plain);
}

const GZIP_THRESHOLD = 600;

/** JSON → (gzip) → AES-GCM → base64 envelope for the relay. */
export async function encryptJSON(key: CryptoKey, value: unknown, forceGzip = false): Promise<EncryptedPayload> {
  const text = JSON.stringify(value);
  const zip = forceGzip || text.length > GZIP_THRESHOLD;
  const plain = zip ? await gzip(text) : new TextEncoder().encode(text);
  const iv = randomBytes(12);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, ab(plain)));
  const payload: EncryptedPayload = { iv: bytesToBase64(iv), data: bytesToBase64(cipher) };
  if (zip) payload.z = 1;
  return payload;
}

export async function decryptJSON<T = unknown>(key: CryptoKey, p: EncryptedPayload): Promise<T> {
  const plain = new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv: ab(base64ToBytes(p.iv)) }, key, ab(base64ToBytes(p.data))),
  );
  const text = p.z ? await gunzip(plain) : new TextDecoder().decode(plain);
  return JSON.parse(text) as T;
}
