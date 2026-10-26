import { test } from "node:test";
import assert from "node:assert/strict";
import { decryptBytes, decryptJSON, encryptBytes, encryptJSON, generateKey, importKey, ROOM_KEY_RE } from "../src/collab/crypto.ts";
import { gunzip, gzip } from "../src/core/utils.ts";

test("generated keys are 128-bit base64url (fits in the URL fragment)", async () => {
  const k = await generateKey();
  assert.match(k, ROOM_KEY_RE);
});

test("bytes round-trip through AES-GCM", async () => {
  const key = await importKey(await generateKey());
  const data = new TextEncoder().encode("hello excalimade ".repeat(100));
  const enc = await encryptBytes(key, data);
  assert.notDeepEqual(enc.slice(12, 40), data.slice(0, 28)); // ciphertext differs from plaintext
  assert.deepEqual(await decryptBytes(key, enc), data);
});

test("share-link payload: gzip + encrypt → decrypt + gunzip", async () => {
  const scene = { type: "excalidraw", elements: [{ id: "a", type: "rectangle" }], files: {} };
  const key = await importKey(await generateKey());
  const enc = await encryptBytes(key, await gzip(JSON.stringify(scene)));
  assert.deepEqual(JSON.parse(await gunzip(await decryptBytes(key, enc))), scene);
});

test("JSON payloads round-trip", async () => {
  const key = await importKey(await generateKey());
  const value = { type: "update", elements: [1, 2, 3], text: "ünïcødé ✓" };
  assert.deepEqual(await decryptJSON(key, await encryptJSON(key, value)), value);
});

test("decrypting with the wrong key fails", async () => {
  const enc = await encryptBytes(await importKey(await generateKey()), new Uint8Array([1, 2, 3]));
  await assert.rejects(decryptBytes(await importKey(await generateKey()), enc));
});

test("tampered ciphertext is rejected", async () => {
  const key = await importKey(await generateKey());
  const enc = await encryptBytes(key, new Uint8Array(64).fill(9));
  enc[enc.length - 1] ^= 0xff;
  await assert.rejects(decryptBytes(key, enc));
});
