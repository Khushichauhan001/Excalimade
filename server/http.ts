import type http from "node:http";

export type ApiHandler = (req: http.IncomingMessage, res: http.ServerResponse, url: URL) => Promise<boolean> | boolean;

/** Read a JSON request body (limit protects the server from huge payloads). */
export async function readJson<T = any>(req: http.IncomingMessage, limit = 20 * 1024 * 1024): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error("Payload too large"), { status: 413 });
    chunks.push(c);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : ({} as T);
}

export function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

