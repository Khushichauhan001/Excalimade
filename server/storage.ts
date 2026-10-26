// Object storage for encrypted blobs (share links, room snapshots).
// Uses Vercel Blob when BLOB_READ_WRITE_TOKEN is set (production on Vercel and the Render relay),
// otherwise the local filesystem (development). Everything stored here is already encrypted
// client-side, so the store never sees plaintext.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { get, put } from "@vercel/blob";

export const useBlob = () => !!process.env.BLOB_READ_WRITE_TOKEN;
const access = () => (process.env.BLOB_ACCESS === "private" ? "private" : "public");

/** Writable data dir: server/data locally, /tmp on serverless (read-only filesystem elsewhere). */
export const DATA_DIR = process.env.VERCEL ? path.join(os.tmpdir(), "excalimade") : path.resolve(import.meta.dirname, "data");

const diskPath = (key: string) => path.join(DATA_DIR, ...key.split("/"));

export async function putObject(key: string, bytes: Buffer): Promise<void> {
  if (useBlob()) {
    await put(key, bytes, {
      access: access(),
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/octet-stream",
      cacheControlMaxAge: 60,
    });
    return;
  }
  const file = diskPath(key);
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  await fs.promises.writeFile(tmp, bytes);
  await fs.promises.rename(tmp, file);
}

export async function getObject(key: string): Promise<Buffer | null> {
  if (useBlob()) {
    try {
      const res = await get(key, { access: access(), useCache: false });
      if (!res || res.statusCode !== 200) return null;
      return Buffer.from(await new Response(res.stream).arrayBuffer());
    } catch (e: any) {
      if (/not.?found|404/i.test(String(e?.message ?? e))) return null;
      throw e;
    }
  }
  try {
    return await fs.promises.readFile(diskPath(key));
  } catch {
    return null;
  }
}
