// Single Node server: REST API (/api/*), WebSocket rooms (/ws), and static files from dist/ in production.
// Run with `npm run server` (tsx). Feature modules plug in below; each owns its own file.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { WebSocketServer } from "ws";
import { handleCollabSocket, handleShare } from "./collab";
import { handleCloud } from "./cloud";
import { handleAI } from "./ai";
import { handleLibraries } from "./libraries";
import { sendJson, type ApiHandler } from "./http";

const PORT = Number(process.env.PORT ?? 3001);
const DIST = path.resolve(import.meta.dirname, "../dist");

const handlers: ApiHandler[] = [handleShare, handleCloud, handleAI, handleLibraries];

const MIME: Record<string, string> = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
  ".png": "image/png", ".woff2": "font/woff2", ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".ico": "image/x-icon",
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  try {
    if (url.pathname === "/health") return sendJson(res, 200, { ok: true });
    if (url.pathname.startsWith("/api/")) {
      for (const h of handlers) if (await h(req, res, url)) return;
      return sendJson(res, 404, { error: "Not found" });
    }
    // static (production build)
    let file = path.join(DIST, decodeURIComponent(url.pathname));
    if (!file.startsWith(DIST)) return sendJson(res, 403, { error: "Forbidden" });
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, "index.html");
    if (!fs.existsSync(file)) return sendJson(res, 404, { error: "Build the client first: npm run build" });
    const ext = path.extname(file);
    res.writeHead(200, {
      "Content-Type": MIME[ext] ?? "application/octet-stream",
      "Cache-Control": url.pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
    });
    fs.createReadStream(file).pipe(res);
  } catch (err: any) {
    console.error(err);
    if (!res.headersSent) sendJson(res, err.status ?? 500, { error: err.message ?? "Server error" });
  }
});

// ALLOWED_ORIGINS="https://excalimade.vercel.app,https://my-domain.com" restricts which sites may open
// collaboration sockets (the relay only ever sees ciphertext, this just stops other sites using it).
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean);
const wss = new WebSocketServer({
  server,
  path: "/ws",
  maxPayload: 50 * 1024 * 1024,
  verifyClient: ({ origin }: { origin?: string }) => !allowedOrigins.length || !origin || allowedOrigins.includes(origin),
});
wss.on("connection", (socket, req) => handleCollabSocket(socket, req));

server.listen(PORT, () => console.log(`Excalimade server on http://localhost:${PORT}`));
