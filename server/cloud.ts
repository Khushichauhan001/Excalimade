// Excalimade+ cloud API: accounts, workspaces & teams, collections, scenes (gzip blobs + WebP thumbnails),
// sharing & per-scene permissions, persistent collab rooms, comments + notifications, and version history.
// Every permission is enforced here; the client only mirrors it for UI purposes.
import type http from "node:http";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { promisify } from "node:util";
import { readJson, sendJson, type ApiHandler } from "./http";
import { all, get, run, tx } from "./db";

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number, opts: crypto.ScryptOptions) => Promise<Buffer>;

// ---- constants ---------------------------------------------------------------------------------

const DAY = 24 * 60 * 60 * 1000;
const SESSION_TTL = 30 * DAY;
const TRASH_TTL = 30 * DAY;
const AUTOSAVE_VERSION_INTERVAL = 10 * 60 * 1000;
const MAX_UNNAMED_VERSIONS = 50;
const MAX_SCENE_BYTES = 20 * 1024 * 1024;
const MAX_THUMB_BYTES = 256 * 1024;
const COOKIE = "em_session";
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const USER_COLORS = ["#e03131", "#c2255c", "#9c36b5", "#6741d9", "#3b5bdb", "#1971c2", "#0c8599", "#099268", "#2f9e44", "#e8590c", "#f08c00"];

type Role = "owner" | "admin" | "member" | "viewer";
type Perm = "none" | "view" | "edit";
const ROLES: Role[] = ["owner", "admin", "member", "viewer"];
const PERM_RANK: Record<Perm, number> = { none: 0, view: 1, edit: 2 };

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
const fail = (status: number, message: string): never => {
  throw new HttpError(status, message);
};

// ---- row types -----------------------------------------------------------------------------------

interface UserRow { id: string; email: string; name: string; color: string; password: string; created_at: number }
interface WorkspaceRow { id: string; name: string; personal: number; owner_id: string; invite_token: string | null; invite_role: Role; created_at: number }
interface SceneRow {
  id: string; workspace_id: string; collection_id: string | null; owner_id: string | null; name: string;
  visibility: "private" | "workspace" | "link"; data_size: number; room_id: string; room_key: string;
  view_token: string | null; edit_token: string | null; revision: number; created_at: number; updated_at: number;
  updated_by: string | null; last_version_at: number; deleted_at: number | null; has_thumb: number;
}
const SCENE_COLS = `s.id, s.workspace_id, s.collection_id, s.owner_id, s.name, s.visibility, s.data_size, s.room_id, s.room_key,
  s.view_token, s.edit_token, s.revision, s.created_at, s.updated_at, s.updated_by, s.last_version_at, s.deleted_at,
  (s.thumb IS NOT NULL) AS has_thumb`;

// ---- helpers ---------------------------------------------------------------------------------------

const newId = () => crypto.randomBytes(12).toString("base64url");
const newToken = (bytes = 24) => crypto.randomBytes(bytes).toString("base64url");
const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const now = () => Date.now();

const safeEqual = (a: string, b: string) => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
};

const str = (v: unknown, field: string, max = 120, min = 1): string => {
  if (typeof v !== "string") fail(400, `${field} is required`);
  const s = (v as string).trim();
  if (s.length < min) fail(400, `${field} is required`);
  if (s.length > max) fail(400, `${field} is too long (max ${max} characters)`);
  return s;
};
const optStr = (v: unknown, field: string, max = 120) => (v == null || v === "" ? null : str(v, field, max));
const num = (v: unknown, field: string) => {
  if (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > 1e9) fail(400, `${field} must be a number`);
  return v as number;
};
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COLOR_RE = /^#[0-9a-f]{6}$/i;

const publicUser = (u: Pick<UserRow, "id" | "name" | "color">) => ({ id: u.id, name: u.name, color: u.color });
const selfUser = (u: UserRow) => ({ id: u.id, email: u.email, name: u.name, color: u.color, createdAt: u.created_at });

function clientIp(req: http.IncomingMessage) {
  const remote = req.socket.remoteAddress ?? "unknown";
  // Only trust X-Forwarded-For from a local reverse proxy (vite dev proxy / nginx on the same host).
  const fwd = req.headers["x-forwarded-for"];
  if (fwd && (remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1")) {
    return String(Array.isArray(fwd) ? fwd[0] : fwd).split(",")[0].trim();
  }
  return remote;
}

// ---- rate limiting (in memory, per IP) ---------------------------------------------------------------

const buckets = new Map<string, { count: number; reset: number }>();
function rateLimit(key: string, limit: number, windowMs: number) {
  const t = now();
  let b = buckets.get(key);
  if (!b || b.reset <= t) {
    b = { count: 0, reset: t + windowMs };
    buckets.set(key, b);
  }
  b.count++;
  if (b.count > limit) {
    const err = new HttpError(429, "Too many attempts. Please wait a few minutes and try again.");
    (err as any).retryAfter = Math.ceil((b.reset - t) / 1000);
    throw err;
  }
}
setInterval(() => {
  const t = now();
  for (const [k, b] of buckets) if (b.reset <= t) buckets.delete(k);
}, 60_000).unref();

// ---- passwords & sessions ------------------------------------------------------------------------

async function hashPassword(password: string) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${salt.toString("base64")}$${hash.toString("base64")}`;
}
const DUMMY_HASH = hashPassword(newToken());

async function verifyPassword(password: string, stored: string) {
  const [alg, n, saltB64, hashB64] = stored.split("$");
  if (alg !== "scrypt") return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length, { N: Number(n), r: SCRYPT.r, p: SCRYPT.p });
  return crypto.timingSafeEqual(actual, expected);
}

function parseCookies(req: http.IncomingMessage) {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const isSecure = (req: http.IncomingMessage) =>
  (req.socket as any).encrypted === true || req.headers["x-forwarded-proto"] === "https";

function setSessionCookie(req: http.IncomingMessage, res: http.ServerResponse, token: string | null) {
  const parts = [
    `${COOKIE}=${token ?? ""}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    token ? `Max-Age=${Math.floor(SESSION_TTL / 1000)}` : "Max-Age=0",
  ];
  if (isSecure(req)) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function createSession(req: http.IncomingMessage, res: http.ServerResponse, userId: string) {
  const token = newToken(32);
  const t = now();
  run("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)", sha256(token), userId, t, t + SESSION_TTL);
  setSessionCookie(req, res, token);
}

function currentUser(req: http.IncomingMessage): UserRow | null {
  const token = parseCookies(req)[COOKIE];
  if (!token || token.length > 100) return null;
  const row = get<UserRow & { expires_at: number; token_hash: string }>(
    `SELECT u.*, s.expires_at, s.token_hash FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
    sha256(token),
  );
  if (!row) return null;
  if (row.expires_at < now()) {
    run("DELETE FROM sessions WHERE token_hash = ?", row.token_hash);
    return null;
  }
  // sliding expiry: extend once a day at most
  if (row.expires_at - now() < SESSION_TTL - DAY) {
    run("UPDATE sessions SET expires_at = ? WHERE token_hash = ?", now() + SESSION_TTL, row.token_hash);
  }
  return row;
}

const requireUser = (req: http.IncomingMessage) => currentUser(req) ?? fail(401, "Please sign in to continue");

// ---- workspaces ----------------------------------------------------------------------------------

const memberRole = (workspaceId: string, userId: string) =>
  get<{ role: Role }>("SELECT role FROM members WHERE workspace_id = ? AND user_id = ?", workspaceId, userId)?.role ?? null;

function requireMember(workspaceId: string, user: UserRow, min: Role = "viewer") {
  const ws = get<WorkspaceRow>("SELECT * FROM workspaces WHERE id = ?", workspaceId) ?? fail(404, "Workspace not found");
  const role = memberRole(ws.id, user.id);
  if (!role) fail(404, "Workspace not found");
  if (ROLES.indexOf(role!) > ROLES.indexOf(min)) fail(403, "You don't have permission to do that in this workspace");
  return { ws, role: role as Role };
}

function createWorkspace(userId: string, name: string, personal: boolean) {
  const id = newId();
  const t = now();
  run("INSERT INTO workspaces (id, name, personal, owner_id, invite_token, invite_role, created_at) VALUES (?, ?, ?, ?, ?, 'member', ?)",
    id, name, personal ? 1 : 0, userId, personal ? null : newToken(18), t);
  run("INSERT INTO members (workspace_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)", id, userId, t);
  return id;
}

function listWorkspaces(userId: string) {
  return all<any>(
    `SELECT w.id, w.name, w.personal, w.created_at, m.role,
       (SELECT COUNT(*) FROM members m2 WHERE m2.workspace_id = w.id) AS member_count
     FROM members m JOIN workspaces w ON w.id = m.workspace_id
     WHERE m.user_id = ? ORDER BY w.personal DESC, w.name COLLATE NOCASE`,
    userId,
  ).map((w) => ({ id: w.id, name: w.name, personal: !!w.personal, role: w.role, memberCount: w.member_count, createdAt: w.created_at }));
}

// ---- scenes & permissions ------------------------------------------------------------------------

interface Access { perm: Perm; manage: boolean; wsRole: Role | null; viaToken: boolean }

function sceneAccess(scene: SceneRow, user: UserRow | null, token: string | null): Access {
  const wsRole = user ? memberRole(scene.workspace_id, user.id) : null;
  const isOwner = !!user && scene.owner_id === user.id && !!wsRole;
  const isAdmin = wsRole === "owner" || wsRole === "admin";
  const manage = isOwner || (isAdmin && scene.visibility !== "private");
  if (scene.deleted_at) {
    // trashed scenes are only reachable by people who can restore them
    return manage ? { perm: "edit", manage, wsRole, viaToken: false } : { perm: "none", manage: false, wsRole, viaToken: false };
  }
  let perm: Perm = "none";
  if (isOwner || manage) perm = "edit";
  else if (user && wsRole) {
    const override = get<{ role: Perm }>("SELECT role FROM scene_access WHERE scene_id = ? AND user_id = ?", scene.id, user.id);
    if (override) perm = override.role;
    else if (scene.visibility !== "private") perm = wsRole === "viewer" ? "view" : "edit";
  }
  let viaToken = false;
  if (token && scene.visibility === "link" && PERM_RANK[perm] < PERM_RANK.edit) {
    if (scene.edit_token && safeEqual(token, scene.edit_token)) {
      // edit links need an account so changes are attributed; signed-out visitors get view access
      const p: Perm = user ? "edit" : "view";
      if (PERM_RANK[p] > PERM_RANK[perm]) { perm = p; viaToken = true; }
    } else if (scene.view_token && safeEqual(token, scene.view_token) && perm === "none") {
      perm = "view";
      viaToken = true;
    }
  }
  return { perm, manage, wsRole, viaToken };
}

function loadScene(id: string, includeDeleted = false) {
  const scene = get<SceneRow>(`SELECT ${SCENE_COLS} FROM scenes s WHERE s.id = ?`, id);
  if (!scene || (!includeDeleted && scene.deleted_at)) fail(404, "Scene not found");
  return scene as SceneRow;
}

/** Load a scene and check access. Unauthorised → 404 (don't leak existence), or 403 when the user can see it. */
function sceneFor(id: string, user: UserRow | null, token: string | null, need: Perm, opts: { includeDeleted?: boolean } = {}) {
  const scene = loadScene(id, opts.includeDeleted);
  const access = sceneAccess(scene, user, token);
  if (access.perm === "none") fail(user ? 404 : 401, user ? "Scene not found or you don't have access" : "Please sign in to open this scene");
  if (PERM_RANK[access.perm] < PERM_RANK[need]) fail(403, "You only have view access to this scene");
  return { scene, access };
}

function sceneMeta(scene: SceneRow, access: Access, user: UserRow | null) {
  const ws = get<{ name: string; personal: number }>("SELECT name, personal FROM workspaces WHERE id = ?", scene.workspace_id)!;
  const owner = scene.owner_id ? get<UserRow>("SELECT id, name, color FROM users WHERE id = ?", scene.owner_id) : undefined;
  const updatedBy = scene.updated_by ? get<UserRow>("SELECT id, name, color FROM users WHERE id = ?", scene.updated_by) : undefined;
  const isMember = !!access.wsRole;
  const collection = scene.collection_id && isMember
    ? get<{ id: string; name: string }>("SELECT id, name FROM collections WHERE id = ?", scene.collection_id) ?? null
    : null;
  const canEdit = access.perm === "edit";
  return {
    id: scene.id,
    name: scene.name,
    workspaceId: isMember ? scene.workspace_id : null,
    workspaceName: isMember ? ws.name : null,
    personalWorkspace: isMember ? !!ws.personal : false,
    collectionId: isMember ? scene.collection_id : null,
    collectionName: collection?.name ?? null,
    visibility: scene.visibility,
    owner: owner ? publicUser(owner) : null,
    updatedBy: updatedBy ? publicUser(updatedBy) : null,
    createdAt: scene.created_at,
    updatedAt: scene.updated_at,
    deletedAt: scene.deleted_at,
    revision: scene.revision,
    size: scene.data_size,
    hasThumb: !!scene.has_thumb,
    permission: access.perm,
    canManage: access.manage,
    canComment: !!user && access.perm !== "none",
    viaLink: access.viaToken,
    // the persistent room key is only handed to editors
    room: canEdit ? { roomId: scene.room_id, roomKey: scene.room_key } : null,
    share: access.manage
      ? { viewToken: scene.view_token, editToken: scene.edit_token }
      : canEdit && scene.visibility === "link"
        ? { viewToken: scene.view_token, editToken: null }
        : null,
    isOwner: !!user && scene.owner_id === user.id,
  };
}

const listItem = (s: SceneRow & { owner_name?: string; owner_color?: string; collection_name?: string | null }) => ({
  id: s.id,
  name: s.name,
  collectionId: s.collection_id,
  visibility: s.visibility,
  owner: s.owner_id ? { id: s.owner_id, name: s.owner_name ?? "", color: s.owner_color ?? "#888" } : null,
  createdAt: s.created_at,
  updatedAt: s.updated_at,
  deletedAt: s.deleted_at,
  size: s.data_size,
  hasThumb: !!s.has_thumb,
});

/** Validate an incoming scene object and gzip it. */
function packScene(scene: unknown) {
  if (!scene || typeof scene !== "object") fail(400, "scene is required");
  const s = scene as { type?: unknown; elements?: unknown };
  if (s.type !== "excalidraw" || !Array.isArray(s.elements)) fail(400, "Invalid scene data");
  const json = JSON.stringify(scene);
  if (json.length > MAX_SCENE_BYTES) fail(413, "Scene is too large (max 20 MB)");
  const data = zlib.gzipSync(json, { level: 6 });
  return { data, size: json.length };
}

const isWebP = (b: Buffer) => b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP";
const isPng = (b: Buffer) => b.length > 8 && b[0] === 0x89 && b.toString("ascii", 1, 4) === "PNG";

function parseThumb(v: unknown): Buffer | null {
  if (v == null || v === "") return null;
  if (typeof v !== "string") fail(400, "Invalid thumbnail");
  const b64 = (v as string).replace(/^data:image\/(webp|png);base64,/, "");
  const buf = Buffer.from(b64, "base64");
  if (buf.length > MAX_THUMB_BYTES) fail(413, "Thumbnail too large");
  if (!isWebP(buf) && !isPng(buf)) fail(400, "Thumbnail must be WebP or PNG");
  return buf;
}

function maybeCreateVersion(sceneId: string, data: Buffer, size: number, thumb: Buffer | null, authorId: string, opts: { force: boolean; name?: string | null; restoredFrom?: number | null }) {
  const scene = get<{ last_version_at: number }>("SELECT last_version_at FROM scenes WHERE id = ?", sceneId)!;
  const t = now();
  if (!opts.force && t - scene.last_version_at < AUTOSAVE_VERSION_INTERVAL) return null;
  const latest = get<{ id: string; data: Uint8Array; name: string | null }>(
    "SELECT id, data, name FROM versions WHERE scene_id = ? ORDER BY created_at DESC LIMIT 1", sceneId);
  if (latest && Buffer.from(latest.data).equals(data) && !opts.name && opts.restoredFrom == null) {
    // identical to the latest snapshot — just bump the timer
    run("UPDATE scenes SET last_version_at = ? WHERE id = ?", t, sceneId);
    return opts.force ? latest.id : null;
  }
  const id = newId();
  run(`INSERT INTO versions (id, scene_id, data, data_size, thumb, name, restored_from, author_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, sceneId, data, size, thumb, opts.name ?? null, opts.restoredFrom ?? null, authorId, t);
  run("UPDATE scenes SET last_version_at = ? WHERE id = ?", t, sceneId);
  // prune: keep the newest unnamed snapshots, named versions are kept forever
  run(`DELETE FROM versions WHERE scene_id = ? AND name IS NULL AND id NOT IN (
         SELECT id FROM versions WHERE scene_id = ? AND name IS NULL ORDER BY created_at DESC LIMIT ?)`,
    sceneId, sceneId, MAX_UNNAMED_VERSIONS);
  return id;
}

function newRoom() {
  return { roomId: crypto.randomBytes(10).toString("hex"), roomKey: crypto.randomBytes(16).toString("base64url") };
}

// ---- comments ------------------------------------------------------------------------------------

function threadPayload(threadIds: string[] | null, sceneId: string, userId: string) {
  const threads = all<any>(
    `SELECT t.*, u.name AS creator_name, u.color AS creator_color, r.read_at
     FROM threads t LEFT JOIN users u ON u.id = t.created_by
     LEFT JOIN thread_reads r ON r.thread_id = t.id AND r.user_id = ?
     WHERE t.scene_id = ? ORDER BY t.created_at`, userId, sceneId,
  ).filter((t) => !threadIds || threadIds.includes(t.id));
  const comments = all<any>(
    `SELECT c.*, u.name AS author_name, u.color AS author_color FROM comments c
     JOIN threads t ON t.id = c.thread_id LEFT JOIN users u ON u.id = c.author_id
     WHERE t.scene_id = ? ORDER BY c.created_at`, sceneId,
  );
  const byThread = new Map<string, any[]>();
  for (const c of comments) {
    const list = byThread.get(c.thread_id) ?? [];
    list.push({
      id: c.id,
      body: c.body,
      mentions: JSON.parse(c.mentions),
      author: c.author_id ? { id: c.author_id, name: c.author_name, color: c.author_color } : null,
      createdAt: c.created_at,
      editedAt: c.edited_at,
    });
    byThread.set(c.thread_id, list);
  }
  return threads.map((t) => {
    const list = byThread.get(t.id) ?? [];
    const unread = list.some((c) => c.author?.id !== userId && c.createdAt > (t.read_at ?? 0));
    return {
      id: t.id,
      x: t.x,
      y: t.y,
      elementId: t.element_id,
      ox: t.ox,
      oy: t.oy,
      createdBy: t.created_by ? { id: t.created_by, name: t.creator_name, color: t.creator_color } : null,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
      resolvedAt: t.resolved_at,
      resolvedBy: t.resolved_by,
      comments: list,
      unread,
    };
  });
}

/** Mentionable people: workspace members (+ anyone with an explicit override). Emails never included. */
function scenePeople(scene: SceneRow) {
  return all<{ id: string; name: string; color: string }>(
    `SELECT u.id, u.name, u.color FROM members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ?
     UNION SELECT u.id, u.name, u.color FROM scene_access a JOIN users u ON u.id = a.user_id WHERE a.scene_id = ? AND a.role != 'none'
     ORDER BY 2 COLLATE NOCASE`, scene.workspace_id, scene.id,
  );
}

function parseMentions(v: unknown, scene: SceneRow): string[] {
  if (!Array.isArray(v)) return [];
  const ids = [...new Set(v.filter((x): x is string => typeof x === "string"))].slice(0, 20);
  const allowed = new Set(scenePeople(scene).map((p) => p.id));
  return ids.filter((id) => allowed.has(id));
}

function notify(scene: SceneRow, threadId: string, commentId: string, actor: UserRow, mentions: string[]) {
  const t = now();
  const notified = new Set<string>([actor.id]);
  const canSee = (uid: string) => {
    const u = get<UserRow>("SELECT * FROM users WHERE id = ?", uid);
    return !!u && sceneAccess(scene, u, null).perm !== "none";
  };
  for (const uid of mentions) {
    if (notified.has(uid) || !canSee(uid)) continue;
    notified.add(uid);
    run("INSERT INTO notifications (id, user_id, kind, scene_id, thread_id, comment_id, actor_id, created_at) VALUES (?, ?, 'mention', ?, ?, ?, ?, ?)",
      newId(), uid, scene.id, threadId, commentId, actor.id, t);
  }
  const participants = all<{ uid: string }>(
    `SELECT DISTINCT author_id AS uid FROM comments WHERE thread_id = ? AND author_id IS NOT NULL
     UNION SELECT created_by FROM threads WHERE id = ? AND created_by IS NOT NULL`, threadId, threadId);
  for (const { uid } of participants) {
    if (notified.has(uid) || !canSee(uid)) continue;
    notified.add(uid);
    run("INSERT INTO notifications (id, user_id, kind, scene_id, thread_id, comment_id, actor_id, created_at) VALUES (?, ?, 'reply', ?, ?, ?, ?, ?)",
      newId(), uid, scene.id, threadId, commentId, actor.id, t);
  }
}

function threadFor(threadId: string, user: UserRow, token: string | null) {
  const thread = get<any>("SELECT * FROM threads WHERE id = ?", threadId) ?? fail(404, "Comment thread not found");
  const { scene, access } = sceneFor(thread.scene_id, user, token, "view");
  return { thread, scene, access };
}

// ---- housekeeping ----------------------------------------------------------------------------------

function housekeeping() {
  try {
    const t = now();
    run("DELETE FROM sessions WHERE expires_at < ?", t);
    run("DELETE FROM scenes WHERE deleted_at IS NOT NULL AND deleted_at < ?", t - TRASH_TTL);
    run("DELETE FROM notifications WHERE created_at < ?", t - 90 * DAY);
  } catch (err) {
    console.error("[cloud] housekeeping failed", err);
  }
}
housekeeping();
setInterval(housekeeping, 60 * 60 * 1000).unref();

// ---- routing -----------------------------------------------------------------------------------------

interface Ctx {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  params: string[];
  body: () => Promise<any>;
  token: string | null;
}
type Route = [method: string, pattern: RegExp, handler: (c: Ctx) => unknown | Promise<unknown>];
const ID = "([A-Za-z0-9_-]{1,64})";
const routes: Route[] = [];
const route = (method: string, path: string, handler: Route[2]) =>
  routes.push([method, new RegExp("^" + path.replaceAll(":id", ID) + "$"), handler]);

// -- auth --

route("POST", "/api/auth/signup", async ({ req, res, body }) => {
  rateLimit("auth:" + clientIp(req), 20, 15 * 60 * 1000);
  const b = await body();
  const email = str(b.email, "Email", 254).toLowerCase();
  if (!EMAIL_RE.test(email)) fail(400, "Please enter a valid email address");
  const name = str(b.name, "Name", 60);
  const password = typeof b.password === "string" ? b.password : "";
  if (password.length < 8) fail(400, "Password must be at least 8 characters");
  if (password.length > 200) fail(400, "Password is too long");
  if (get("SELECT 1 FROM users WHERE email = ?", email)) fail(409, "An account with this email already exists. Sign in instead.");
  const hash = await hashPassword(password);
  const id = newId();
  const color = USER_COLORS[crypto.randomInt(USER_COLORS.length)];
  tx(() => {
    run("INSERT INTO users (id, email, name, color, password, created_at) VALUES (?, ?, ?, ?, ?, ?)", id, email, name, color, hash, now());
    createWorkspace(id, `${name.split(" ")[0]}'s workspace`, true);
  });
  createSession(req, res, id);
  return { user: selfUser(get<UserRow>("SELECT * FROM users WHERE id = ?", id)!) };
});

route("POST", "/api/auth/signin", async ({ req, res, body }) => {
  const ip = clientIp(req);
  rateLimit("auth:" + ip, 20, 15 * 60 * 1000);
  const b = await body();
  const email = typeof b.email === "string" ? b.email.trim().toLowerCase().slice(0, 254) : "";
  const password = typeof b.password === "string" ? b.password.slice(0, 200) : "";
  rateLimit("signin:" + email, 10, 15 * 60 * 1000);
  const user = email ? get<UserRow>("SELECT * FROM users WHERE email = ?", email) : undefined;
  // always run scrypt so response time doesn't reveal whether the email exists
  const ok = await verifyPassword(password, user?.password ?? (await DUMMY_HASH));
  if (!user || !ok) fail(401, "Incorrect email or password");
  createSession(req, res, user!.id);
  return { user: selfUser(user!) };
});

route("POST", "/api/auth/signout", ({ req, res }) => {
  const token = parseCookies(req)[COOKIE];
  if (token) run("DELETE FROM sessions WHERE token_hash = ?", sha256(token));
  setSessionCookie(req, res, null);
  return { ok: true };
});

route("GET", "/api/me", ({ req }) => {
  const user = currentUser(req);
  return { user: user ? selfUser(user) : null };
});

route("PATCH", "/api/me", async ({ req, body }) => {
  const user = requireUser(req);
  const b = await body();
  if (b.name !== undefined) run("UPDATE users SET name = ? WHERE id = ?", str(b.name, "Name", 60), user.id);
  if (b.color !== undefined) {
    if (typeof b.color !== "string" || !COLOR_RE.test(b.color)) fail(400, "Invalid color");
    run("UPDATE users SET color = ? WHERE id = ?", b.color, user.id);
  }
  if (b.newPassword !== undefined) {
    rateLimit("auth:" + clientIp(req), 20, 15 * 60 * 1000);
    if (!(await verifyPassword(String(b.currentPassword ?? ""), user.password))) fail(403, "Current password is incorrect");
    const pw = String(b.newPassword);
    if (pw.length < 8 || pw.length > 200) fail(400, "Password must be 8–200 characters");
    run("UPDATE users SET password = ? WHERE id = ?", await hashPassword(pw), user.id);
    // sign out other sessions
    const cur = sha256(parseCookies(req)[COOKIE] ?? "");
    run("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?", user.id, cur);
  }
  return { user: selfUser(get<UserRow>("SELECT * FROM users WHERE id = ?", user.id)!) };
});

// -- notifications --

route("GET", "/api/notifications", ({ req }) => {
  const user = requireUser(req);
  const rows = all<any>(
    `SELECT n.*, s.name AS scene_name, s.deleted_at, a.name AS actor_name, a.color AS actor_color, c.body
     FROM notifications n JOIN scenes s ON s.id = n.scene_id
     LEFT JOIN users a ON a.id = n.actor_id JOIN comments c ON c.id = n.comment_id
     WHERE n.user_id = ? ORDER BY n.created_at DESC LIMIT 60`, user.id);
  const items = rows
    .filter((n) => !n.deleted_at && sceneAccess(loadScene(n.scene_id, true), user, null).perm !== "none")
    .slice(0, 40)
    .map((n) => ({
      id: n.id,
      kind: n.kind,
      sceneId: n.scene_id,
      sceneName: n.scene_name,
      threadId: n.thread_id,
      commentId: n.comment_id,
      actor: n.actor_id ? { id: n.actor_id, name: n.actor_name, color: n.actor_color } : null,
      snippet: String(n.body).slice(0, 160),
      createdAt: n.created_at,
      read: !!n.read_at,
    }));
  const unread = get<{ c: number }>("SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read_at IS NULL", user.id)!.c;
  return { items, unread };
});

route("POST", "/api/notifications/read", async ({ req, body }) => {
  const user = requireUser(req);
  const b = await body();
  if (Array.isArray(b.ids)) {
    for (const id of b.ids.slice(0, 200)) if (typeof id === "string") run("UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL", now(), id, user.id);
  } else run("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL", now(), user.id);
  return { ok: true };
});

// -- workspaces --

route("GET", "/api/cloud/workspaces", ({ req }) => ({ workspaces: listWorkspaces(requireUser(req).id) }));

route("POST", "/api/cloud/workspaces", async ({ req, body }) => {
  const user = requireUser(req);
  const b = await body();
  const name = str(b.name, "Workspace name", 60);
  if ((get<{ c: number }>("SELECT COUNT(*) AS c FROM workspaces WHERE owner_id = ?", user.id)?.c ?? 0) >= 50) fail(400, "Workspace limit reached");
  const id = tx(() => createWorkspace(user.id, name, false));
  return { workspace: listWorkspaces(user.id).find((w) => w.id === id) };
});

route("PATCH", "/api/cloud/workspaces/:id", async ({ req, params, body }) => {
  const user = requireUser(req);
  const { ws } = requireMember(params[0], user, "admin");
  const b = await body();
  run("UPDATE workspaces SET name = ? WHERE id = ?", str(b.name, "Workspace name", 60), ws.id);
  return { workspace: listWorkspaces(user.id).find((w) => w.id === ws.id) };
});

route("DELETE", "/api/cloud/workspaces/:id", ({ req, params }) => {
  const user = requireUser(req);
  const { ws } = requireMember(params[0], user, "owner");
  if (ws.personal) fail(400, "Your personal workspace can't be deleted");
  run("DELETE FROM workspaces WHERE id = ?", ws.id);
  return { ok: true };
});

route("GET", "/api/cloud/workspaces/:id/members", ({ req, params }) => {
  const user = requireUser(req);
  const { ws, role } = requireMember(params[0], user);
  const members = all<any>(
    `SELECT u.id, u.name, u.color, u.email, m.role, m.joined_at FROM members m JOIN users u ON u.id = m.user_id
     WHERE m.workspace_id = ? ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END, u.name COLLATE NOCASE`, ws.id,
  ).map((m) => ({ id: m.id, name: m.name, color: m.color, email: m.email, role: m.role, joinedAt: m.joined_at }));
  const isAdmin = role === "owner" || role === "admin";
  return {
    members,
    invite: isAdmin && !ws.personal ? { token: ws.invite_token, role: ws.invite_role } : null,
  };
});

route("POST", "/api/cloud/workspaces/:id/members", async ({ req, params, body }) => {
  const user = requireUser(req);
  const { ws, role: myRole } = requireMember(params[0], user, "admin");
  if (ws.personal) fail(400, "Create a team workspace to invite people");
  const b = await body();
  const email = str(b.email, "Email", 254).toLowerCase();
  const role = (b.role ?? "member") as Role;
  if (!["admin", "member", "viewer"].includes(role)) fail(400, "Invalid role");
  if (role === "admin" && myRole !== "owner" && myRole !== "admin") fail(403, "Only admins can add admins");
  rateLimit("invite:" + user.id, 60, 60 * 60 * 1000);
  const target = get<UserRow>("SELECT * FROM users WHERE email = ?", email);
  if (!target) fail(404, "There's no Excalimade+ account with that email yet. Send them the invite link instead.");
  if (memberRole(ws.id, target!.id)) fail(409, "That person is already a member");
  run("INSERT INTO members (workspace_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)", ws.id, target!.id, role, now());
  return { member: { ...publicUser(target!), email: target!.email, role, joinedAt: now() } };
});

route("PATCH", "/api/cloud/workspaces/:id/members/:id", async ({ req, params, body }) => {
  const user = requireUser(req);
  const { ws, role: myRole } = requireMember(params[0], user, "admin");
  const targetRole = memberRole(ws.id, params[1]) ?? fail(404, "Member not found");
  const b = await body();
  const role = b.role as Role;
  if (!ROLES.includes(role)) fail(400, "Invalid role");
  if (params[1] === user.id) fail(400, "You can't change your own role");
  if (targetRole === "owner") fail(403, "The workspace owner's role can't be changed");
  if (role === "owner") {
    // ownership transfer — owner only; the previous owner becomes an admin
    if (myRole !== "owner") fail(403, "Only the owner can transfer ownership");
    tx(() => {
      run("UPDATE members SET role = 'admin' WHERE workspace_id = ? AND user_id = ?", ws.id, user.id);
      run("UPDATE members SET role = 'owner' WHERE workspace_id = ? AND user_id = ?", ws.id, params[1]);
      run("UPDATE workspaces SET owner_id = ? WHERE id = ?", params[1], ws.id);
    });
    return { ok: true };
  }
  if (myRole === "admin" && targetRole === "admin" && role !== "admin") fail(403, "Only the owner can demote admins");
  run("UPDATE members SET role = ? WHERE workspace_id = ? AND user_id = ?", role, ws.id, params[1]);
  return { ok: true };
});

route("DELETE", "/api/cloud/workspaces/:id/members/:id", ({ req, params }) => {
  const user = requireUser(req);
  const self = params[1] === user.id;
  const { ws, role: myRole } = requireMember(params[0], user, self ? "viewer" : "admin");
  const targetRole = memberRole(ws.id, params[1]) ?? fail(404, "Member not found");
  if (targetRole === "owner") fail(400, self ? "Owners can't leave — transfer ownership or delete the workspace" : "The owner can't be removed");
  if (!self && myRole === "admin" && targetRole === "admin") fail(403, "Only the owner can remove admins");
  tx(() => {
    run("DELETE FROM members WHERE workspace_id = ? AND user_id = ?", ws.id, params[1]);
    run("DELETE FROM scene_access WHERE user_id = ? AND scene_id IN (SELECT id FROM scenes WHERE workspace_id = ?)", params[1], ws.id);
    // the departing member's scenes stay in the workspace, owned by the workspace owner
    run("UPDATE scenes SET owner_id = ?, visibility = CASE visibility WHEN 'private' THEN 'workspace' ELSE visibility END WHERE workspace_id = ? AND owner_id = ?",
      ws.owner_id, ws.id, params[1]);
  });
  return { ok: true };
});

route("POST", "/api/cloud/workspaces/:id/invite", async ({ req, params, body }) => {
  const user = requireUser(req);
  const { ws } = requireMember(params[0], user, "admin");
  if (ws.personal) fail(400, "Create a team workspace to invite people");
  const b = await body();
  const role = (b.role ?? ws.invite_role) as Role;
  if (!["admin", "member", "viewer"].includes(role)) fail(400, "Invalid role");
  const token = b.disable ? null : b.regenerate || !ws.invite_token ? newToken(18) : ws.invite_token;
  run("UPDATE workspaces SET invite_token = ?, invite_role = ? WHERE id = ?", token, role, ws.id);
  return { invite: { token, role } };
});

route("GET", "/api/cloud/invites/:id", ({ req, params }) => {
  rateLimit("invitepeek:" + clientIp(req), 60, 15 * 60 * 1000);
  const ws = get<WorkspaceRow>("SELECT * FROM workspaces WHERE invite_token = ?", params[0]) ?? fail(404, "This invite link is invalid or has been revoked");
  const user = currentUser(req);
  const count = get<{ c: number }>("SELECT COUNT(*) AS c FROM members WHERE workspace_id = ?", ws.id)!.c;
  return { workspace: { id: ws.id, name: ws.name, memberCount: count }, role: ws.invite_role, alreadyMember: !!(user && memberRole(ws.id, user.id)) };
});

route("POST", "/api/cloud/invites/:id/accept", ({ req, params }) => {
  const user = requireUser(req);
  rateLimit("invite-accept:" + clientIp(req), 30, 15 * 60 * 1000);
  const ws = get<WorkspaceRow>("SELECT * FROM workspaces WHERE invite_token = ?", params[0]) ?? fail(404, "This invite link is invalid or has been revoked");
  if (!memberRole(ws.id, user.id)) run("INSERT INTO members (workspace_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)", ws.id, user.id, ws.invite_role, now());
  return { workspace: listWorkspaces(user.id).find((w) => w.id === ws.id) };
});

// -- collections --

route("GET", "/api/cloud/workspaces/:id/collections", ({ req, params }) => {
  const user = requireUser(req);
  const { ws } = requireMember(params[0], user);
  return {
    collections: all<any>(
      `SELECT c.id, c.name, c.created_at,
         (SELECT COUNT(*) FROM scenes s LEFT JOIN scene_access a ON a.scene_id = s.id AND a.user_id = ?
          WHERE s.collection_id = c.id AND s.deleted_at IS NULL
            AND (s.owner_id = ? OR (a.role IS NOT NULL AND a.role != 'none') OR (a.role IS NULL AND s.visibility != 'private'))) AS scene_count
       FROM collections c WHERE c.workspace_id = ? ORDER BY c.name COLLATE NOCASE`, user.id, user.id, ws.id,
    ).map((c) => ({ id: c.id, name: c.name, createdAt: c.created_at, sceneCount: c.scene_count })),
  };
});

route("POST", "/api/cloud/workspaces/:id/collections", async ({ req, params, body }) => {
  const user = requireUser(req);
  const { ws } = requireMember(params[0], user, "member");
  const b = await body();
  const id = newId();
  run("INSERT INTO collections (id, workspace_id, name, created_at) VALUES (?, ?, ?, ?)", id, ws.id, str(b.name, "Collection name", 60), now());
  return { collection: { id, name: str(b.name, "Collection name", 60), createdAt: now(), sceneCount: 0 } };
});

const collectionFor = (id: string, user: UserRow) => {
  const c = get<{ id: string; workspace_id: string }>("SELECT id, workspace_id FROM collections WHERE id = ?", id) ?? fail(404, "Collection not found");
  requireMember(c!.workspace_id, user, "member");
  return c!;
};

route("PATCH", "/api/cloud/collections/:id", async ({ req, params, body }) => {
  const user = requireUser(req);
  const c = collectionFor(params[0], user);
  const b = await body();
  run("UPDATE collections SET name = ? WHERE id = ?", str(b.name, "Collection name", 60), c.id);
  return { ok: true };
});

route("DELETE", "/api/cloud/collections/:id", ({ req, params }) => {
  const user = requireUser(req);
  const c = collectionFor(params[0], user);
  run("DELETE FROM collections WHERE id = ?", c.id); // scenes fall back to "no collection" (ON DELETE SET NULL)
  return { ok: true };
});

// -- scenes --

route("GET", "/api/cloud/workspaces/:id/scenes", ({ req, params, url }) => {
  const user = requireUser(req);
  const { ws, role } = requireMember(params[0], user);
  const trash = url.searchParams.get("trash") === "1";
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const collection = url.searchParams.get("collection");
  const sort = url.searchParams.get("sort");
  const order = sort === "name" ? "s.name COLLATE NOCASE ASC" : sort === "created" ? "s.created_at DESC" : trash ? "s.deleted_at DESC" : "s.updated_at DESC";
  const where = [`s.workspace_id = ?`];
  const args: any[] = [user.id, ws.id];
  if (trash) {
    where.push("s.deleted_at IS NOT NULL");
    if (role === "owner" || role === "admin") where.push("(s.owner_id = ? OR s.visibility != 'private')");
    else where.push("s.owner_id = ?");
    args.push(user.id);
  } else {
    where.push("s.deleted_at IS NULL");
    where.push("(s.owner_id = ? OR (a.role IS NOT NULL AND a.role != 'none') OR (a.role IS NULL AND s.visibility != 'private'))");
    args.push(user.id);
    if (collection) { where.push("s.collection_id = ?"); args.push(collection); }
  }
  if (q) {
    where.push("s.name LIKE ? ESCAPE '\\'");
    args.push("%" + q.replace(/[\\%_]/g, (m) => "\\" + m) + "%");
  }
  const rows = all<any>(
    `SELECT ${SCENE_COLS}, o.name AS owner_name, o.color AS owner_color FROM scenes s
     LEFT JOIN scene_access a ON a.scene_id = s.id AND a.user_id = ?
     LEFT JOIN users o ON o.id = s.owner_id
     WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT 500`, ...args);
  return { scenes: rows.map(listItem), trashTtlDays: TRASH_TTL / DAY };
});

route("POST", "/api/cloud/scenes", async ({ req, body }) => {
  const user = requireUser(req);
  rateLimit("create:" + user.id, 120, 60 * 60 * 1000);
  const b = await body();
  const { ws } = requireMember(str(b.workspaceId, "workspaceId", 64), user, "member");
  let collectionId: string | null = null;
  if (b.collectionId) {
    const c = get<{ workspace_id: string }>("SELECT workspace_id FROM collections WHERE id = ?", String(b.collectionId));
    if (!c || c.workspace_id !== ws.id) fail(400, "Collection not found in this workspace");
    collectionId = String(b.collectionId);
  }
  const name = optStr(b.name, "Name", 120) ?? "Untitled scene";
  const { data, size } = packScene(b.scene);
  const thumb = parseThumb(b.thumb);
  const id = newId();
  const room = newRoom();
  const t = now();
  tx(() => {
    run(`INSERT INTO scenes (id, workspace_id, collection_id, owner_id, name, visibility, data, data_size, thumb, room_id, room_key,
           revision, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      id, ws.id, collectionId, user.id, name, ws.personal ? "private" : "workspace", data, size, thumb, room.roomId, room.roomKey, t, t, user.id);
    maybeCreateVersion(id, data, size, thumb, user.id, { force: true });
  });
  const scene = loadScene(id);
  return { scene: sceneMeta(scene, sceneAccess(scene, user, null), user) };
});

route("GET", "/api/cloud/scenes/:id", ({ req, params, token }) => {
  const user = currentUser(req);
  const { scene, access } = sceneFor(params[0], user, token, "view", { includeDeleted: true });
  return { scene: sceneMeta(scene, access, user) };
});

route("GET", "/api/cloud/scenes/:id/data", ({ req, res, params, token }) => {
  const user = currentUser(req);
  const { scene } = sceneFor(params[0], user, token, "view");
  const row = get<{ data: Uint8Array }>("SELECT data FROM scenes WHERE id = ?", scene.id)!;
  sendGzipJson(req, res, Buffer.from(row.data), { revision: scene.revision });
  return SENT;
});

route("PUT", "/api/cloud/scenes/:id/data", async ({ req, params, token }) => {
  const user = requireUser(req);
  const b = await readJson(req, MAX_SCENE_BYTES + MAX_THUMB_BYTES * 2);
  const { scene } = sceneFor(params[0], user, token ?? (typeof b.t === "string" ? b.t : null), "edit");
  const { data, size } = packScene(b.scene);
  const thumb = b.thumb === undefined ? undefined : parseThumb(b.thumb);
  const explicit = b.explicit === true;
  const restoredFrom = typeof b.restoredFrom === "number" ? b.restoredFrom : null;
  const t = now();
  const result = tx(() => {
    if (thumb !== undefined) run("UPDATE scenes SET thumb = ? WHERE id = ?", thumb, scene.id);
    run("UPDATE scenes SET data = ?, data_size = ?, revision = revision + 1, updated_at = ?, updated_by = ? WHERE id = ?",
      data, size, t, user.id, scene.id);
    const thumbNow = get<{ thumb: Uint8Array | null }>("SELECT thumb FROM scenes WHERE id = ?", scene.id)!.thumb;
    const versionId = maybeCreateVersion(scene.id, data, size, thumbNow ? Buffer.from(thumbNow) : null, user.id, {
      force: explicit || restoredFrom != null,
      name: optStr(b.versionName, "Version name", 80),
      restoredFrom,
    });
    return { versionId };
  });
  return { revision: scene.revision + 1, updatedAt: t, versionId: result.versionId };
});

route("GET", "/api/cloud/scenes/:id/thumb", ({ req, res, params, token }) => {
  const user = currentUser(req);
  const { scene } = sceneFor(params[0], user, token, "view", { includeDeleted: true });
  const row = get<{ thumb: Uint8Array | null }>("SELECT thumb FROM scenes WHERE id = ?", scene.id)!;
  sendImage(req, res, row.thumb, `"${scene.id}-${scene.updated_at}"`);
  return SENT;
});

route("PATCH", "/api/cloud/scenes/:id", async ({ req, params, body, token }) => {
  const user = requireUser(req);
  const b = await body();
  const { scene, access } = sceneFor(params[0], user, token ?? (typeof b.t === "string" ? b.t : null), "edit");
  if (b.name !== undefined) run("UPDATE scenes SET name = ?, updated_at = ? WHERE id = ?", str(b.name, "Name", 120), now(), scene.id);
  let workspaceId = scene.workspace_id;
  if (b.workspaceId !== undefined && b.workspaceId !== scene.workspace_id) {
    if (!access.manage) fail(403, "Only the scene owner or a workspace admin can move it to another workspace");
    const target = requireMember(str(b.workspaceId, "workspaceId", 64), user, "member");
    workspaceId = target.ws.id;
    tx(() => {
      run("UPDATE scenes SET workspace_id = ?, collection_id = NULL, owner_id = ?, visibility = ? WHERE id = ?",
        workspaceId, user.id, target.ws.personal ? "private" : scene.visibility === "private" ? "private" : "workspace", scene.id);
      run("DELETE FROM scene_access WHERE scene_id = ?", scene.id);
      // a moved scene gets a fresh room and links — old collaborators lose access
      const room = newRoom();
      run("UPDATE scenes SET room_id = ?, room_key = ?, view_token = NULL, edit_token = NULL WHERE id = ?", room.roomId, room.roomKey, scene.id);
    });
  }
  if (b.collectionId !== undefined) {
    if (!access.wsRole || access.wsRole === "viewer") fail(403, "Only workspace members can organise scenes");
    if (b.collectionId === null) run("UPDATE scenes SET collection_id = NULL WHERE id = ?", scene.id);
    else {
      const c = get<{ workspace_id: string }>("SELECT workspace_id FROM collections WHERE id = ?", String(b.collectionId));
      if (!c || c.workspace_id !== workspaceId) fail(400, "Collection not found in this workspace");
      run("UPDATE scenes SET collection_id = ? WHERE id = ?", String(b.collectionId), scene.id);
    }
  }
  if (b.visibility !== undefined) {
    if (!access.manage) fail(403, "Only the scene owner or a workspace admin can change who has access");
    if (!["private", "workspace", "link"].includes(b.visibility)) fail(400, "Invalid visibility");
    run("UPDATE scenes SET visibility = ? WHERE id = ?", b.visibility, scene.id);
    if (b.visibility === "link" && !scene.view_token) run("UPDATE scenes SET view_token = ? WHERE id = ?", newToken(), scene.id);
  }
  const updated = loadScene(scene.id);
  return { scene: sceneMeta(updated, sceneAccess(updated, user, token), user) };
});

route("POST", "/api/cloud/scenes/:id/share", async ({ req, params, body }) => {
  const user = requireUser(req);
  const { scene, access } = sceneFor(params[0], user, null, "edit");
  if (!access.manage) fail(403, "Only the scene owner or a workspace admin can manage links");
  const b = await body();
  const kind = b.link === "edit" ? "edit_token" : "view_token";
  if (b.action === "revoke") run(`UPDATE scenes SET ${kind} = NULL WHERE id = ?`, scene.id);
  else if (b.action === "regenerate" || b.action === "enable") {
    run(`UPDATE scenes SET ${kind} = ?, visibility = CASE visibility WHEN 'private' THEN 'link' WHEN 'workspace' THEN 'link' ELSE visibility END WHERE id = ?`, newToken(), scene.id);
    if (b.action === "enable" && kind === "edit_token" && !scene.view_token) run("UPDATE scenes SET view_token = ? WHERE id = ?", newToken(), scene.id);
  } else fail(400, "Unknown action");
  const updated = loadScene(scene.id);
  return { scene: sceneMeta(updated, sceneAccess(updated, user, null), user) };
});

route("GET", "/api/cloud/scenes/:id/access", ({ req, params }) => {
  const user = requireUser(req);
  const { scene, access } = sceneFor(params[0], user, null, "edit");
  if (!access.manage) fail(403, "Only the scene owner or a workspace admin can manage access");
  const people = all<any>(
    `SELECT u.id, u.name, u.color, u.email, m.role AS ws_role, a.role AS override FROM members m
     JOIN users u ON u.id = m.user_id LEFT JOIN scene_access a ON a.scene_id = ? AND a.user_id = u.id
     WHERE m.workspace_id = ? ORDER BY u.name COLLATE NOCASE`, scene.id, scene.workspace_id);
  return {
    people: people.map((p) => ({
      id: p.id, name: p.name, color: p.color, email: p.email, workspaceRole: p.ws_role, override: p.override,
      isOwner: p.id === scene.owner_id,
      effective: sceneAccess(scene, { id: p.id } as UserRow, null).perm,
    })),
  };
});

route("PUT", "/api/cloud/scenes/:id/access/:id", async ({ req, params, body }) => {
  const user = requireUser(req);
  const { scene, access } = sceneFor(params[0], user, null, "edit");
  if (!access.manage) fail(403, "Only the scene owner or a workspace admin can manage access");
  if (!memberRole(scene.workspace_id, params[1])) fail(404, "That person isn't a member of this workspace");
  if (params[1] === scene.owner_id) fail(400, "The scene owner always has full access");
  const b = await body();
  if (b.role === "default" || b.role === null) run("DELETE FROM scene_access WHERE scene_id = ? AND user_id = ?", scene.id, params[1]);
  else if (["none", "view", "edit"].includes(b.role))
    run("INSERT INTO scene_access (scene_id, user_id, role) VALUES (?, ?, ?) ON CONFLICT(scene_id, user_id) DO UPDATE SET role = excluded.role", scene.id, params[1], b.role);
  else fail(400, "Invalid role");
  return { ok: true };
});

route("POST", "/api/cloud/scenes/:id/duplicate", async ({ req, params, body, token }) => {
  const user = requireUser(req);
  rateLimit("create:" + user.id, 120, 60 * 60 * 1000);
  const b = await body();
  const { scene, access } = sceneFor(params[0], user, token ?? (typeof b.t === "string" ? b.t : null), "view");
  let targetWs = typeof b.workspaceId === "string" ? b.workspaceId : access.wsRole && access.wsRole !== "viewer" ? scene.workspace_id : null;
  if (!targetWs) targetWs = get<{ id: string }>("SELECT w.id FROM workspaces w JOIN members m ON m.workspace_id = w.id WHERE m.user_id = ? AND w.personal = 1", user.id)!.id;
  const { ws } = requireMember(targetWs!, user, "member");
  const src = get<{ data: Uint8Array; thumb: Uint8Array | null; data_size: number }>("SELECT data, thumb, data_size FROM scenes WHERE id = ?", scene.id)!;
  const id = newId();
  const room = newRoom();
  const t = now();
  const name = optStr(b.name, "Name", 120) ?? `${scene.name} (copy)`.slice(0, 120);
  const collectionId = ws.id === scene.workspace_id ? scene.collection_id : null;
  tx(() => {
    run(`INSERT INTO scenes (id, workspace_id, collection_id, owner_id, name, visibility, data, data_size, thumb, room_id, room_key,
           revision, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      id, ws.id, collectionId, user.id, name, ws.personal ? "private" : "workspace", src.data, src.data_size, src.thumb, room.roomId, room.roomKey, t, t, user.id);
    maybeCreateVersion(id, Buffer.from(src.data), src.data_size, src.thumb ? Buffer.from(src.thumb) : null, user.id, { force: true });
  });
  const created = loadScene(id);
  return { scene: sceneMeta(created, sceneAccess(created, user, null), user) };
});

const canTrash = (access: Access) => access.manage || (access.wsRole != null && access.wsRole !== "viewer" && access.perm === "edit");

route("DELETE", "/api/cloud/scenes/:id", ({ req, params, url }) => {
  const user = requireUser(req);
  const permanent = url.searchParams.get("permanent") === "1";
  const { scene, access } = sceneFor(params[0], user, null, "edit", { includeDeleted: true });
  if (!canTrash(access)) fail(403, "You can't delete this scene");
  if (permanent) {
    if (!scene.deleted_at) fail(400, "Move the scene to the trash first");
    run("DELETE FROM scenes WHERE id = ?", scene.id);
  } else run("UPDATE scenes SET deleted_at = ? WHERE id = ?", now(), scene.id);
  return { ok: true };
});

route("POST", "/api/cloud/scenes/:id/restore", ({ req, params }) => {
  const user = requireUser(req);
  const { scene, access } = sceneFor(params[0], user, null, "edit", { includeDeleted: true });
  if (!canTrash(access)) fail(403, "You can't restore this scene");
  run("UPDATE scenes SET deleted_at = NULL WHERE id = ?", scene.id);
  return { ok: true };
});

route("GET", "/api/cloud/scenes/:id/people", ({ req, params, token }) => {
  const user = requireUser(req);
  const { scene } = sceneFor(params[0], user, token, "view");
  return { people: scenePeople(scene) };
});

// -- versions --

route("GET", "/api/cloud/scenes/:id/versions", ({ req, params, token }) => {
  const user = requireUser(req);
  const { scene } = sceneFor(params[0], user, token, "view");
  const versions = all<any>(
    `SELECT v.id, v.name, v.data_size, v.restored_from, v.created_at, (v.thumb IS NOT NULL) AS has_thumb,
       u.id AS author_id, u.name AS author_name, u.color AS author_color
     FROM versions v LEFT JOIN users u ON u.id = v.author_id WHERE v.scene_id = ? ORDER BY v.created_at DESC`, scene.id,
  ).map((v) => ({
    id: v.id, name: v.name, size: v.data_size, restoredFrom: v.restored_from, createdAt: v.created_at, hasThumb: !!v.has_thumb,
    author: v.author_id ? { id: v.author_id, name: v.author_name, color: v.author_color } : null,
  }));
  return { versions, keep: MAX_UNNAMED_VERSIONS };
});

const versionFor = (sceneId: string, versionId: string) =>
  get<any>("SELECT * FROM versions WHERE id = ? AND scene_id = ?", versionId, sceneId) ?? fail(404, "Version not found");

route("GET", "/api/cloud/scenes/:id/versions/:id/data", ({ req, res, params, token }) => {
  const user = requireUser(req);
  const { scene } = sceneFor(params[0], user, token, "view");
  const v = versionFor(scene.id, params[1]);
  sendGzipJson(req, res, Buffer.from(v.data), {});
  return SENT;
});

route("GET", "/api/cloud/scenes/:id/versions/:id/thumb", ({ req, res, params, token }) => {
  const user = requireUser(req);
  const { scene } = sceneFor(params[0], user, token, "view");
  const v = versionFor(scene.id, params[1]);
  sendImage(req, res, v.thumb, `"${v.id}"`, true);
  return SENT;
});

route("PATCH", "/api/cloud/scenes/:id/versions/:id", async ({ req, params, body, token }) => {
  const user = requireUser(req);
  const { scene } = sceneFor(params[0], user, token, "edit");
  const v = versionFor(scene.id, params[1]);
  const b = await body();
  run("UPDATE versions SET name = ? WHERE id = ?", optStr(b.name, "Version name", 80), v.id);
  // un-naming may push the scene over the unnamed-version limit
  run(`DELETE FROM versions WHERE scene_id = ? AND name IS NULL AND id NOT IN (
         SELECT id FROM versions WHERE scene_id = ? AND name IS NULL ORDER BY created_at DESC LIMIT ?)`,
    scene.id, scene.id, MAX_UNNAMED_VERSIONS);
  return { ok: true };
});

route("POST", "/api/cloud/scenes/:id/versions", async ({ req, params, body, token }) => {
  const user = requireUser(req);
  const { scene } = sceneFor(params[0], user, token, "edit");
  const b = await body();
  const name = optStr(b.name, "Version name", 80);
  const row = get<{ data: Uint8Array; thumb: Uint8Array | null; data_size: number }>("SELECT data, thumb, data_size FROM scenes WHERE id = ?", scene.id)!;
  const id = newId();
  run(`INSERT INTO versions (id, scene_id, data, data_size, thumb, name, author_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id, scene.id, row.data, row.data_size, row.thumb, name, user.id, now());
  run("UPDATE scenes SET last_version_at = ? WHERE id = ?", now(), scene.id);
  return { versionId: id };
});

route("DELETE", "/api/cloud/scenes/:id/versions/:id", ({ req, params }) => {
  const user = requireUser(req);
  const { scene, access } = sceneFor(params[0], user, null, "edit");
  if (!access.manage) fail(403, "Only the scene owner or a workspace admin can delete versions");
  versionFor(scene.id, params[1]);
  run("DELETE FROM versions WHERE id = ?", params[1]);
  return { ok: true };
});

// -- comments --

route("GET", "/api/cloud/scenes/:id/threads", ({ req, params, token }) => {
  const user = requireUser(req);
  const { scene } = sceneFor(params[0], user, token, "view");
  return { threads: threadPayload(null, scene.id, user.id) };
});

const commentBody = (v: unknown) => str(v, "Comment", 5000);

route("POST", "/api/cloud/scenes/:id/threads", async ({ req, params, body, token }) => {
  const user = requireUser(req);
  rateLimit("comment:" + user.id, 240, 60 * 60 * 1000);
  const b = await body();
  const { scene } = sceneFor(params[0], user, token ?? (typeof b.t === "string" ? b.t : null), "view");
  const text = commentBody(b.body);
  const mentions = parseMentions(b.mentions, scene);
  const threadId = newId();
  const commentId = newId();
  const t = now();
  tx(() => {
    run(`INSERT INTO threads (id, scene_id, x, y, element_id, ox, oy, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      threadId, scene.id, num(b.x, "x"), num(b.y, "y"), typeof b.elementId === "string" ? b.elementId.slice(0, 64) : null,
      typeof b.ox === "number" ? num(b.ox, "ox") : 0, typeof b.oy === "number" ? num(b.oy, "oy") : 0, user.id, t, t);
    run("INSERT INTO comments (id, thread_id, author_id, body, mentions, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      commentId, threadId, user.id, text, JSON.stringify(mentions), t);
    run("INSERT INTO thread_reads (thread_id, user_id, read_at) VALUES (?, ?, ?)", threadId, user.id, t);
    notify(scene, threadId, commentId, user, mentions);
  });
  return { thread: threadPayload([threadId], scene.id, user.id)[0] };
});

route("PATCH", "/api/cloud/threads/:id", async ({ req, params, body, token }) => {
  const user = requireUser(req);
  const b = await body();
  const { thread, scene, access } = threadFor(params[0], user, token ?? (typeof b.t === "string" ? b.t : null));
  const t = now();
  if (b.resolved !== undefined) {
    run("UPDATE threads SET resolved_at = ?, resolved_by = ?, updated_at = ? WHERE id = ?",
      b.resolved ? t : null, b.resolved ? user.id : null, t, thread.id);
  }
  if (b.x !== undefined || b.y !== undefined) {
    if (thread.created_by !== user.id && !access.manage) fail(403, "Only the author can move this comment");
    run("UPDATE threads SET x = ?, y = ?, element_id = ?, ox = ?, oy = ?, updated_at = ? WHERE id = ?",
      num(b.x, "x"), num(b.y, "y"), typeof b.elementId === "string" ? b.elementId.slice(0, 64) : null,
      typeof b.ox === "number" ? num(b.ox, "ox") : 0, typeof b.oy === "number" ? num(b.oy, "oy") : 0, t, thread.id);
  }
  return { thread: threadPayload([thread.id], scene.id, user.id)[0] };
});

route("DELETE", "/api/cloud/threads/:id", ({ req, params, token }) => {
  const user = requireUser(req);
  const { thread, access } = threadFor(params[0], user, token);
  if (thread.created_by !== user.id && !access.manage) fail(403, "Only the author can delete this thread");
  run("DELETE FROM threads WHERE id = ?", thread.id);
  return { ok: true };
});

route("POST", "/api/cloud/threads/:id/comments", async ({ req, params, body, token }) => {
  const user = requireUser(req);
  rateLimit("comment:" + user.id, 240, 60 * 60 * 1000);
  const b = await body();
  const { thread, scene } = threadFor(params[0], user, token ?? (typeof b.t === "string" ? b.t : null));
  const text = commentBody(b.body);
  const mentions = parseMentions(b.mentions, scene);
  const id = newId();
  const t = now();
  tx(() => {
    run("INSERT INTO comments (id, thread_id, author_id, body, mentions, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      id, thread.id, user.id, text, JSON.stringify(mentions), t);
    // replying re-opens a resolved thread
    run("UPDATE threads SET updated_at = ?, resolved_at = NULL, resolved_by = NULL WHERE id = ?", t, thread.id);
    run("INSERT INTO thread_reads (thread_id, user_id, read_at) VALUES (?, ?, ?) ON CONFLICT(thread_id, user_id) DO UPDATE SET read_at = excluded.read_at", thread.id, user.id, t);
    notify(scene, thread.id, id, user, mentions);
  });
  return { thread: threadPayload([thread.id], scene.id, user.id)[0] };
});

route("POST", "/api/cloud/threads/:id/read", ({ req, params, token }) => {
  const user = requireUser(req);
  const { thread } = threadFor(params[0], user, token);
  const t = now();
  run("INSERT INTO thread_reads (thread_id, user_id, read_at) VALUES (?, ?, ?) ON CONFLICT(thread_id, user_id) DO UPDATE SET read_at = excluded.read_at", thread.id, user.id, t);
  run("UPDATE notifications SET read_at = ? WHERE user_id = ? AND thread_id = ? AND read_at IS NULL", t, user.id, thread.id);
  return { ok: true };
});

const commentFor = (id: string, user: UserRow, token: string | null) => {
  const c = get<any>("SELECT * FROM comments WHERE id = ?", id) ?? fail(404, "Comment not found");
  const ctx = threadFor(c.thread_id, user, token);
  return { comment: c, ...ctx };
};

route("PATCH", "/api/cloud/comments/:id", async ({ req, params, body, token }) => {
  const user = requireUser(req);
  const b = await body();
  const { comment, scene, thread } = commentFor(params[0], user, token ?? (typeof b.t === "string" ? b.t : null));
  if (comment.author_id !== user.id) fail(403, "You can only edit your own comments");
  const mentions = parseMentions(b.mentions, scene);
  const prev = new Set<string>(JSON.parse(comment.mentions));
  tx(() => {
    run("UPDATE comments SET body = ?, mentions = ?, edited_at = ? WHERE id = ?", commentBody(b.body), JSON.stringify(mentions), now(), comment.id);
    const added = mentions.filter((m) => !prev.has(m));
    if (added.length) notify(scene, thread.id, comment.id, user, added);
  });
  return { thread: threadPayload([thread.id], scene.id, user.id)[0] };
});

route("DELETE", "/api/cloud/comments/:id", ({ req, params, token }) => {
  const user = requireUser(req);
  const { comment, thread, scene } = commentFor(params[0], user, token);
  if (comment.author_id !== user.id) fail(403, "You can only delete your own comments");
  const first = get<{ id: string }>("SELECT id FROM comments WHERE thread_id = ? ORDER BY created_at LIMIT 1", thread.id)!;
  if (first.id === comment.id) {
    // deleting the opening comment removes the whole thread
    run("DELETE FROM threads WHERE id = ?", thread.id);
    return { threadDeleted: true };
  }
  run("DELETE FROM comments WHERE id = ?", comment.id);
  return { thread: threadPayload([thread.id], scene.id, user.id)[0] };
});

// ---- response helpers -------------------------------------------------------------------------------

const SENT = Symbol("sent");

function sendGzipJson(req: http.IncomingMessage, res: http.ServerResponse, gz: Buffer, extra: { revision?: number }) {
  const headers: Record<string, string | number> = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    Vary: "Accept-Encoding",
  };
  if (extra.revision != null) headers["X-Scene-Revision"] = extra.revision;
  if (/\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""))) {
    res.writeHead(200, { ...headers, "Content-Encoding": "gzip", "Content-Length": gz.length });
    res.end(gz);
  } else {
    const raw = zlib.gunzipSync(gz);
    res.writeHead(200, { ...headers, "Content-Length": raw.length });
    res.end(raw);
  }
}

function sendImage(req: http.IncomingMessage, res: http.ServerResponse, data: Uint8Array | null, etag: string, immutable = false) {
  if (!data) {
    res.writeHead(404, { "Cache-Control": "no-store" });
    res.end();
    return;
  }
  const buf = Buffer.from(data);
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, { ETag: etag });
    res.end();
    return;
  }
  res.writeHead(200, {
    "Content-Type": isWebP(buf) ? "image/webp" : "image/png",
    "Content-Length": buf.length,
    ETag: etag,
    "Cache-Control": immutable ? "private, max-age=31536000, immutable" : "private, no-cache",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(buf);
}

const PREFIXES = ["/api/cloud/", "/api/auth/", "/api/me", "/api/notifications"];

export const handleCloud: ApiHandler = async (req, res, url) => {
  const p = url.pathname;
  if (!PREFIXES.some((pre) => p === pre || p.startsWith(pre))) return false;
  if (p.startsWith("/api/me") && p !== "/api/me") return false;
  const method = req.method ?? "GET";
  try {
    // CSRF hardening on top of SameSite=Lax: state-changing requests must be JSON (forces a CORS preflight cross-site)
    if (method !== "GET" && method !== "HEAD" && method !== "DELETE") {
      const ct = String(req.headers["content-type"] ?? "");
      if (!ct.startsWith("application/json")) fail(415, "Expected application/json");
    }
    const origin = req.headers.origin;
    if (origin && method !== "GET" && method !== "HEAD") {
      const hosts = [req.headers.host, req.headers["x-forwarded-host"]].flat().filter(Boolean);
      try {
        if (!hosts.includes(new URL(origin).host)) fail(403, "Cross-origin request blocked");
      } catch {
        fail(403, "Cross-origin request blocked");
      }
    }
    let pathMatched = false;
    for (const [m, re, handler] of routes) {
      const match = re.exec(p);
      if (!match) continue;
      pathMatched = true;
      if (m !== method) continue;
      let bodyCache: Promise<any> | null = null;
      const ctx: Ctx = {
        req, res, url,
        params: match.slice(1),
        body: () => (bodyCache ??= readJson(req, 1024 * 1024).then((b) => (b && typeof b === "object" ? b : {}))),
        token: url.searchParams.get("t"),
      };
      const out = await handler(ctx);
      if (out !== SENT) sendJson(res, 200, out ?? { ok: true });
      return true;
    }
    sendJson(res, pathMatched ? 405 : 404, { error: pathMatched ? "Method not allowed" : "Not found" });
  } catch (err: any) {
    if (err instanceof SyntaxError) return (sendJson(res, 400, { error: "Invalid JSON" }), true);
    const status = err instanceof HttpError ? err.status : err?.status ?? 500;
    if (status >= 500) console.error("[cloud]", err);
    if (err?.retryAfter) res.setHeader("Retry-After", String(err.retryAfter));
    if (!res.headersSent) sendJson(res, status, { error: status >= 500 ? "Server error" : err.message });
  }
  return true;
};
