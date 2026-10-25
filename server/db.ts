// SQLite storage for the cloud module (accounts, workspaces, scenes, comments, versions).
// Uses Node's built-in `node:sqlite` — no extra dependencies. Scene blobs are gzip-compressed,
// thumbnails are small WebP images. Migrations run once on startup.
import { DatabaseSync, type StatementSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.resolve(import.meta.dirname, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });
export const DB_PATH = path.join(DATA_DIR, "excalimade.db");

export const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 3000;");

/** Ordered schema migrations. Never edit an applied migration — append a new one. */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    password TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  CREATE INDEX sessions_expiry ON sessions(expires_at);

  CREATE TABLE workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    personal INTEGER NOT NULL DEFAULT 0,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invite_token TEXT UNIQUE,
    invite_role TEXT NOT NULL DEFAULT 'member',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX workspaces_owner ON workspaces(owner_id);

  CREATE TABLE members (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner','admin','member','viewer')),
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, user_id)
  );
  CREATE INDEX members_user ON members(user_id);

  CREATE TABLE collections (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX collections_ws ON collections(workspace_id);

  CREATE TABLE scenes (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    collection_id TEXT REFERENCES collections(id) ON DELETE SET NULL,
    owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    visibility TEXT NOT NULL DEFAULT 'workspace' CHECK (visibility IN ('private','workspace','link')),
    data BLOB NOT NULL,
    data_size INTEGER NOT NULL,
    thumb BLOB,
    room_id TEXT NOT NULL,
    room_key TEXT NOT NULL,
    view_token TEXT UNIQUE,
    edit_token TEXT UNIQUE,
    revision INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    last_version_at INTEGER NOT NULL DEFAULT 0,
    deleted_at INTEGER
  );
  CREATE INDEX scenes_ws ON scenes(workspace_id, deleted_at, updated_at);
  CREATE INDEX scenes_collection ON scenes(collection_id);
  CREATE INDEX scenes_deleted ON scenes(deleted_at);

  CREATE TABLE scene_access (
    scene_id TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('none','view','edit')),
    PRIMARY KEY (scene_id, user_id)
  );

  CREATE TABLE versions (
    id TEXT PRIMARY KEY,
    scene_id TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
    data BLOB NOT NULL,
    data_size INTEGER NOT NULL,
    thumb BLOB,
    name TEXT,
    restored_from INTEGER,
    author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX versions_scene ON versions(scene_id, created_at);

  CREATE TABLE threads (
    id TEXT PRIMARY KEY,
    scene_id TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
    x REAL NOT NULL,
    y REAL NOT NULL,
    element_id TEXT,
    ox REAL NOT NULL DEFAULT 0,
    oy REAL NOT NULL DEFAULT 0,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    resolved_at INTEGER,
    resolved_by TEXT REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE INDEX threads_scene ON threads(scene_id);

  CREATE TABLE comments (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    body TEXT NOT NULL,
    mentions TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    edited_at INTEGER
  );
  CREATE INDEX comments_thread ON comments(thread_id, created_at);

  CREATE TABLE thread_reads (
    thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    read_at INTEGER NOT NULL,
    PRIMARY KEY (thread_id, user_id)
  );

  CREATE TABLE notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('mention','reply')),
    scene_id TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
    thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    comment_id TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
    actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    read_at INTEGER
  );
  CREATE INDEX notifications_user ON notifications(user_id, created_at);
  `,
];

function migrate() {
  db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
  const row = db.prepare("SELECT version FROM schema_version").get() as { version: number } | undefined;
  let current = row?.version ?? 0;
  if (!row) db.prepare("INSERT INTO schema_version (version) VALUES (0)").run();
  while (current < MIGRATIONS.length) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[current]);
      current++;
      db.prepare("UPDATE schema_version SET version = ?").run(current);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}
migrate();

/** Cached prepared statements (SQL text → statement). */
const cache = new Map<string, StatementSync>();
export const sql = (text: string) => {
  let st = cache.get(text);
  if (!st) {
    st = db.prepare(text);
    cache.set(text, st);
  }
  return st;
};

export const get = <T>(text: string, ...params: any[]) => sql(text).get(...params) as T | undefined;
export const all = <T>(text: string, ...params: any[]) => sql(text).all(...params) as T[];
export const run = (text: string, ...params: any[]) => sql(text).run(...params);

/** Run `fn` inside a transaction (synchronous — node:sqlite is sync). */
export function tx<T>(fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
