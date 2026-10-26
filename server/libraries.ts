// Public libraries proxy (libraries.excalidraw.com) with in-memory + disk caching.
//   GET /api/libraries                     → libraries.json (6h TTL, stale copy served if upstream fails)
//   GET /api/libraries/file?path=<source>  → one .excalidrawlib file (cached on disk)
import fs from "node:fs";
import path from "node:path";
import { sendJson, type ApiHandler } from "./http";

const UPSTREAM = "https://libraries.excalidraw.com";
import { DATA_DIR } from "./storage";
const LIST_FILE = path.join(DATA_DIR, "libraries.json");
const FILE_DIR = path.join(DATA_DIR, "libraries");
const TTL = 6 * 60 * 60 * 1000;
const FILE_TTL = 7 * 24 * 60 * 60 * 1000;
const MAX_LIST = 20 * 1024 * 1024;
const MAX_FILE = 25 * 1024 * 1024;
const PATH_RE = /^[\w\-./]+\.excalidrawlib$/;

let list: { fetchedAt: number; body: string } | null = null;
let inflight: Promise<string> | null = null;

async function fetchText(url: string, limit: number) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { "User-Agent": "Excalimade library proxy" } });
  if (!res.ok) throw Object.assign(new Error(`Upstream ${res.status}`), { status: res.status === 404 ? 404 : 502 });
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > limit) throw Object.assign(new Error("Upstream file too large"), { status: 502 });
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > limit) throw Object.assign(new Error("Upstream file too large"), { status: 502 });
  return buf.toString("utf8");
}

function readDiskList() {
  try {
    const parsed = JSON.parse(fs.readFileSync(LIST_FILE, "utf8")) as { fetchedAt: number; data: unknown };
    if (typeof parsed.fetchedAt === "number" && Array.isArray(parsed.data)) return { fetchedAt: parsed.fetchedAt, body: JSON.stringify(parsed.data) };
  } catch {
    /* no cache yet */
  }
  return null;
}

async function refreshList(): Promise<string> {
  inflight ??= (async () => {
    try {
      const text = await fetchText(`${UPSTREAM}/libraries.json`, MAX_LIST);
      const data = JSON.parse(text);
      if (!Array.isArray(data)) throw new Error("Unexpected libraries.json format");
      const body = JSON.stringify(data);
      list = { fetchedAt: Date.now(), body };
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(LIST_FILE, JSON.stringify({ fetchedAt: list.fetchedAt, data }));
      return body;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

async function getList(): Promise<string> {
  list ??= readDiskList();
  if (list && Date.now() - list.fetchedAt < TTL) return list.body;
  try {
    return await refreshList();
  } catch (err) {
    if (list) return list.body; // serve stale rather than fail
    throw err;
  }
}

function sendBody(res: Parameters<ApiHandler>[1], body: string, maxAge: number) {
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": `public, max-age=${maxAge}`,
  });
  res.end(body);
}

/** Validated relative path, or null. */
export function safeLibraryPath(p: string | null): string | null {
  if (!p || p.length > 300 || !PATH_RE.test(p)) return null;
  if (p.startsWith("/") || p.startsWith(".") || p.split("/").some((seg) => seg === "" || seg === "." || seg === "..")) return null;
  return p;
}

async function getFile(rel: string): Promise<string> {
  const diskPath = path.join(FILE_DIR, rel.replace(/\//g, "__"));
  if (!diskPath.startsWith(FILE_DIR + path.sep)) throw Object.assign(new Error("Invalid path"), { status: 400 });
  try {
    const st = fs.statSync(diskPath);
    if (Date.now() - st.mtimeMs < FILE_TTL) return fs.readFileSync(diskPath, "utf8");
  } catch {
    /* not cached */
  }
  try {
    const text = await fetchText(`${UPSTREAM}/libraries/${rel.split("/").map(encodeURIComponent).join("/")}`, MAX_FILE);
    const data = JSON.parse(text);
    if (!data || typeof data !== "object" || (!Array.isArray(data.libraryItems) && !Array.isArray(data.library)))
      throw Object.assign(new Error("Not a library file"), { status: 502 });
    fs.mkdirSync(FILE_DIR, { recursive: true });
    fs.writeFileSync(diskPath, text);
    return text;
  } catch (err) {
    if (fs.existsSync(diskPath)) return fs.readFileSync(diskPath, "utf8"); // stale copy
    throw err;
  }
}

export const handleLibraries: ApiHandler = async (req, res, url) => {
  if (url.pathname !== "/api/libraries" && url.pathname !== "/api/libraries/file") return false;
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, 405, { error: "Method not allowed" });
    return true;
  }
  try {
    if (url.pathname === "/api/libraries") {
      sendBody(res, await getList(), 600);
    } else {
      const rel = safeLibraryPath(url.searchParams.get("path"));
      if (!rel) {
        sendJson(res, 400, { error: "Invalid library path" });
        return true;
      }
      sendBody(res, await getFile(rel), 86_400);
    }
  } catch (err: any) {
    console.warn("[libraries]", err?.message ?? err);
    sendJson(res, err?.status === 404 ? 404 : 502, { error: err?.status === 404 ? "Library not found" : "Couldn't reach libraries.excalidraw.com" });
  }
  return true;
};
