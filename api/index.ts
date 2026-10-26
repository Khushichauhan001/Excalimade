// Vercel serverless entry: every /api/* request is rewritten here (see vercel.json) and routed to the
// same handlers the standalone Node server uses. WebSockets are NOT served here — see server/ (Render).
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleAI } from "../server/ai";
import { handleShare } from "../server/collab";
import { handleLibraries } from "../server/libraries";
import { sendJson, type ApiHandler } from "../server/http";

// Vercel sits behind its own proxy: the client IP for rate limiting is in x-forwarded-for.
process.env.TRUST_PROXY ??= "1";

const handlers: ApiHandler[] = [handleShare, handleAI, handleLibraries];

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", `https://${req.headers.host ?? "localhost"}`);
  // the rewrite passes the original sub-path as ?__path=…
  const sub = url.searchParams.get("__path");
  if (sub !== null) {
    url.pathname = `/api/${sub}`;
    url.searchParams.delete("__path");
  }
  try {
    for (const h of handlers) if (await h(req, res, url)) return;
    sendJson(res, 404, { error: `Unknown endpoint ${url.pathname}` });
  } catch (err: any) {
    console.error(err);
    if (!res.headersSent) sendJson(res, err.status ?? 500, { error: err.message ?? "Server error" });
  }
}
