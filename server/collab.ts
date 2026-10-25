// Real-time collaboration relay + encrypted share links.
//
// The server is a dumb, validating relay: scene data, names, cursors and WebRTC signals are
// end-to-end encrypted by the clients (AES-GCM, key lives only in the URL fragment). The server
// only ever sees room ids, socket ids and opaque {iv, data} blobs.
import type http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { WebSocket, RawData } from "ws";
import { sendJson, type ApiHandler } from "./http";

const DATA_DIR = path.resolve(import.meta.dirname, "data");
const ROOMS_DIR = path.join(DATA_DIR, "rooms");
const SHARES_DIR = path.join(DATA_DIR, "shares");

const ROOM_ID_RE = /^[a-f0-9]{20,40}$/;
const SOCKET_ID_RE = /^[a-f0-9]{16}$/;
const SHARE_ID_RE = /^[a-f0-9]{20}$/;
const B64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

const MAX_ROOM_SIZE = 50;
const MAX_RAW_MESSAGE = 26 * 1024 * 1024; // hard cap on any frame (snapshots are the biggest)
const LIMITS: Record<string, number> = {
  join: 1024,
  leave: 1024,
  ping: 256,
  follow: 1024,
  "snapshot-get": 1024,
  volatile: 64 * 1024,
  "rtc-signal": 64 * 1024,
  broadcast: 8 * 1024 * 1024,
  "snapshot-put": MAX_RAW_MESSAGE,
};
const VOLATILE_BUFFER_LIMIT = 1024 * 1024;
const HEARTBEAT_MS = 30_000;
const RATE_PER_SEC = 400; // messages per socket per second (cursors are ~30/s)

const SNAPSHOT_CACHE_BYTES = 256 * 1024 * 1024;
const SNAPSHOT_CACHE_ENTRIES = 1000;
const SHARE_MAX_BYTES = 10 * 1024 * 1024;

interface Client {
  id: string;
  socket: WebSocket;
  roomId: string | null;
  alive: boolean;
  windowStart: number;
  count: number;
}

const rooms = new Map<string, Map<string, Client>>();
const clients = new Set<Client>();
/** Rooms whose snapshot must survive restarts (cloud scenes). */
const persistentRooms = new Set<string>();

// ---- snapshot LRU ---------------------------------------------------------------------------

const snapshots = new Map<string, Buffer>(); // insertion order = LRU order
let snapshotBytes = 0;

function cachePut(roomId: string, buf: Buffer) {
  const old = snapshots.get(roomId);
  if (old) {
    snapshotBytes -= old.length;
    snapshots.delete(roomId);
  }
  snapshots.set(roomId, buf);
  snapshotBytes += buf.length;
  for (const [id, b] of snapshots) {
    if (snapshotBytes <= SNAPSHOT_CACHE_BYTES && snapshots.size <= SNAPSHOT_CACHE_ENTRIES) break;
    if (id === roomId) continue;
    // never evict the snapshot of a room that is still active and not on disk
    if (rooms.has(id) && !persistentRooms.has(id)) continue;
    snapshots.delete(id);
    snapshotBytes -= b.length;
  }
}

function cacheGet(roomId: string) {
  const buf = snapshots.get(roomId);
  if (buf) {
    snapshots.delete(roomId);
    snapshots.set(roomId, buf);
  }
  return buf;
}

const roomFile = (roomId: string) => path.join(ROOMS_DIR, `${roomId}.bin`);

async function writeAtomic(file: string, buf: Buffer) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  await fs.promises.writeFile(tmp, buf);
  await fs.promises.rename(tmp, file);
}

async function loadSnapshot(roomId: string): Promise<Buffer | null> {
  const cached = cacheGet(roomId);
  if (cached) return cached;
  try {
    const buf = await fs.promises.readFile(roomFile(roomId));
    persistentRooms.add(roomId);
    cachePut(roomId, buf);
    return buf;
  } catch {
    return null;
  }
}

// ---- helpers --------------------------------------------------------------------------------

const send = (c: Client, msg: unknown) => {
  if (c.socket.readyState === 1) c.socket.send(JSON.stringify(msg));
};

const roomUsers = (roomId: string) => [...(rooms.get(roomId)?.keys() ?? [])];

function broadcastUsers(roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return;
  const users = [...room.keys()];
  for (const c of room.values()) send(c, { type: "room-users", roomId, users });
}

function leaveRoom(c: Client) {
  const roomId = c.roomId;
  if (!roomId) return;
  c.roomId = null;
  const room = rooms.get(roomId);
  if (!room) return;
  room.delete(c.id);
  if (room.size === 0) rooms.delete(roomId);
  else broadcastUsers(roomId);
}

/** Validates an encrypted payload `{iv, data, z?}` (base64). Returns a clean copy or null. */
function cleanPayload(p: any): { iv: string; data: string; z?: 1 } | null {
  if (!p || typeof p !== "object") return null;
  if (typeof p.iv !== "string" || p.iv.length !== 16 || !B64_RE.test(p.iv)) return null; // 12 bytes
  if (typeof p.data !== "string" || p.data.length < 4 || !B64_RE.test(p.data)) return null;
  return p.z === 1 ? { iv: p.iv, data: p.data, z: 1 } : { iv: p.iv, data: p.data };
}

function rateLimited(c: Client) {
  const now = Date.now();
  if (now - c.windowStart > 1000) {
    c.windowStart = now;
    c.count = 0;
  }
  return ++c.count > RATE_PER_SEC;
}

const error = (c: Client, code: string, message: string) => send(c, { type: "error", code, message });

// ---- heartbeat ------------------------------------------------------------------------------

let heartbeat: ReturnType<typeof setInterval> | null = null;
function ensureHeartbeat() {
  if (heartbeat) return;
  heartbeat = setInterval(() => {
    for (const c of clients) {
      if (!c.alive) {
        c.socket.terminate();
        continue;
      }
      c.alive = false;
      try {
        c.socket.ping();
      } catch {
        /* socket already closing */
      }
    }
    if (!clients.size && heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();
}

// ---- socket handler -------------------------------------------------------------------------

export function handleCollabSocket(socket: WebSocket, req: http.IncomingMessage) {
  void req;
  const c: Client = {
    id: crypto.randomBytes(8).toString("hex"),
    socket,
    roomId: null,
    alive: true,
    windowStart: Date.now(),
    count: 0,
  };
  clients.add(c);
  ensureHeartbeat();

  socket.on("pong", () => (c.alive = true));
  socket.on("close", () => {
    clients.delete(c);
    leaveRoom(c);
  });
  socket.on("error", () => socket.terminate());
  socket.on("message", (raw: RawData, isBinary: boolean) => {
    c.alive = true;
    void onMessage(c, raw, isBinary).catch((err) => {
      console.error("[collab]", err);
      error(c, "server", "Server error");
    });
  });

  send(c, { type: "hello", id: c.id });
}

async function onMessage(c: Client, raw: RawData, isBinary: boolean) {
  if (isBinary) return error(c, "bad-message", "Binary frames are not supported");
  const size = Array.isArray(raw) ? raw.reduce((n, b) => n + b.length, 0) : (raw as Buffer | ArrayBuffer).byteLength;
  if (size > MAX_RAW_MESSAGE) return error(c, "too-large", "Message too large");
  if (rateLimited(c)) return; // silently drop floods

  let msg: any;
  try {
    const text = Array.isArray(raw) ? Buffer.concat(raw).toString("utf8") : Buffer.from(raw as Buffer).toString("utf8");
    msg = JSON.parse(text);
  } catch {
    return error(c, "bad-message", "Invalid JSON");
  }
  if (!msg || typeof msg !== "object" || typeof msg.type !== "string") return error(c, "bad-message", "Missing type");
  const limit = LIMITS[msg.type];
  if (limit === undefined) return error(c, "bad-message", `Unknown message type`);
  if (size > limit) return error(c, "too-large", `${msg.type} message too large`);

  if (msg.type === "ping") return send(c, { type: "pong", t: typeof msg.t === "number" ? msg.t : 0 });

  const roomId = msg.roomId;
  if (typeof roomId !== "string" || !ROOM_ID_RE.test(roomId)) return error(c, "bad-room", "Invalid room id");

  if (msg.type === "join") {
    if (c.roomId === roomId) return;
    leaveRoom(c);
    let room = rooms.get(roomId);
    if (room && room.size >= MAX_ROOM_SIZE) return error(c, "room-full", "This room is full");
    if (!room) rooms.set(roomId, (room = new Map()));
    room.set(c.id, c);
    c.roomId = roomId;
    if (msg.persistent === true) persistentRooms.add(roomId);
    send(c, { type: "joined", roomId, id: c.id, users: roomUsers(roomId) });
    broadcastUsers(roomId);
    return;
  }

  // everything else requires membership of that room
  if (c.roomId !== roomId) return error(c, "not-joined", "Join the room first");
  const room = rooms.get(roomId)!;

  switch (msg.type) {
    case "leave":
      leaveRoom(c);
      return;

    case "broadcast":
    case "volatile": {
      const payload = cleanPayload(msg.payload);
      if (!payload) return error(c, "bad-payload", "Invalid payload");
      const out = JSON.stringify({ type: msg.type, roomId, from: c.id, payload });
      const volatile = msg.type === "volatile";
      if (msg.to !== undefined) {
        if (typeof msg.to !== "string" || !SOCKET_ID_RE.test(msg.to)) return error(c, "bad-target", "Invalid target");
        const target = room.get(msg.to);
        if (!target || target === c) return;
        if (volatile && target.socket.bufferedAmount > VOLATILE_BUFFER_LIMIT) return;
        if (target.socket.readyState === 1) target.socket.send(out);
        return;
      }
      for (const other of room.values()) {
        if (other === c || other.socket.readyState !== 1) continue;
        if (volatile && other.socket.bufferedAmount > VOLATILE_BUFFER_LIMIT) continue;
        other.socket.send(out);
      }
      return;
    }

    case "rtc-signal": {
      const payload = cleanPayload(msg.payload);
      if (!payload) return error(c, "bad-payload", "Invalid payload");
      if (typeof msg.to !== "string" || !SOCKET_ID_RE.test(msg.to)) return error(c, "bad-target", "Invalid target");
      const target = room.get(msg.to);
      if (target && target !== c) send(target, { type: "rtc-signal", roomId, from: c.id, payload });
      return;
    }

    case "follow": {
      if (typeof msg.to !== "string" || !SOCKET_ID_RE.test(msg.to)) return error(c, "bad-target", "Invalid target");
      const target = room.get(msg.to);
      if (target && target !== c) send(target, { type: "follow", roomId, from: c.id, following: msg.following === true });
      return;
    }

    case "snapshot-put": {
      const payload = cleanPayload(msg.payload);
      if (!payload) return error(c, "bad-payload", "Invalid payload");
      const iv = Buffer.from(payload.iv, "base64");
      const data = Buffer.from(payload.data, "base64");
      if (iv.length !== 12 || data.length < 17) return error(c, "bad-payload", "Invalid payload");
      const buf = Buffer.concat([iv, data]);
      cachePut(roomId, buf);
      if (msg.persistent === true) persistentRooms.add(roomId);
      if (persistentRooms.has(roomId)) await writeAtomic(roomFile(roomId), buf);
      send(c, { type: "snapshot-ack", roomId });
      return;
    }

    case "snapshot-get": {
      const buf = await loadSnapshot(roomId);
      send(c, {
        type: "snapshot",
        roomId,
        payload: buf
          ? { iv: buf.subarray(0, 12).toString("base64"), data: buf.subarray(12).toString("base64"), z: 1 }
          : null,
      });
      return;
    }
  }
}

// ---- share links ----------------------------------------------------------------------------

const shareRate = new Map<string, { start: number; count: number }>();
const SHARE_RATE_PER_MIN = 30;

function shareRateLimited(ip: string) {
  const now = Date.now();
  let r = shareRate.get(ip);
  if (!r || now - r.start > 60_000) {
    r = { start: now, count: 0 };
    shareRate.set(ip, r);
    if (shareRate.size > 10_000) for (const [k, v] of shareRate) if (now - v.start > 60_000) shareRate.delete(k);
  }
  return ++r.count > SHARE_RATE_PER_MIN;
}

async function readBytes(req: http.IncomingMessage, limit: number) {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (declared > limit) throw Object.assign(new Error("Payload too large"), { status: 413 });
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("Payload too large"), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** Encrypted read-only share links: POST /api/share (raw bytes) → {id}; GET /api/share/<id> → bytes. */
export const handleShare: ApiHandler = async (req, res, url) => {
  if (url.pathname === "/api/share") {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" }), true;
    const ip = req.socket.remoteAddress ?? "?";
    if (shareRateLimited(ip)) return sendJson(res, 429, { error: "Too many share links, try again in a minute" }), true;
    const body = await readBytes(req, SHARE_MAX_BYTES);
    // iv (12) + GCM tag (16) + at least one byte of ciphertext
    if (body.length < 29) return sendJson(res, 400, { error: "Empty or invalid payload" }), true;
    const id = crypto.randomBytes(10).toString("hex");
    await writeAtomic(path.join(SHARES_DIR, `${id}.bin`), body);
    sendJson(res, 200, { id });
    return true;
  }
  const m = /^\/api\/share\/([^/]+)$/.exec(url.pathname);
  if (!m) return false;
  if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed" }), true;
  const id = m[1];
  if (!SHARE_ID_RE.test(id)) return sendJson(res, 400, { error: "Invalid id" }), true;
  let buf: Buffer;
  try {
    buf = await fs.promises.readFile(path.join(SHARES_DIR, `${id}.bin`));
  } catch {
    return sendJson(res, 404, { error: "Share link not found" }), true;
  }
  res.writeHead(200, {
    "Content-Type": "application/octet-stream",
    "Content-Length": buf.length,
    "Cache-Control": "public, max-age=31536000, immutable",
  });
  res.end(buf);
  return true;
};
