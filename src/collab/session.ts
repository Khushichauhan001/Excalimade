// Live collaboration session: encrypted scene sync, presence, follow mode, file transfer, snapshots.
import { getNonDeletedElements, getState, showToast, useStore, type Store } from "../core/store";
import { emit, on } from "../core/events";
import type { BinaryFile, BinaryFiles, Collaborator, ExcalidrawElement, ImageElement } from "../core/types";
import { base64ToBytes, bytesToBase64, clamp, gunzip, gzip, randomInteger } from "../core/utils";
import { MAX_ZOOM, MIN_ZOOM, zoomToFit } from "../core/viewport";
import {
  decryptJSON,
  encryptJSON,
  generateKey,
  generateRoomId,
  importKey,
  ROOM_ID_RE,
  ROOM_KEY_RE,
  type EncryptedPayload,
} from "./crypto";
import { Portal, type ServerMessage } from "./portal";
import { isValidElement, reconcileElements } from "./reconcile";
import { clearPresence, removeCursor, updateCursor } from "./presence";
import {
  closeAllPeers,
  closePeer,
  handleSignal,
  initRtc,
  mediaState,
  onPeerMediaState,
  shutdownRtc,
} from "./rtc";
import {
  colorForId,
  getCollab,
  getStoredUsername,
  initialCollabState,
  randomUsername,
  setCollab,
  storeUsername,
} from "./state";

type Mode = "create" | "join" | "merge";

export interface StartOptions {
  roomId?: string;
  roomKey?: string;
  persistent?: boolean;
  updateUrl?: boolean;
  /** create: new room, keep local scene · join: room scene replaces local · merge: reconcile both. */
  mode?: Mode;
}

interface FileAssembly {
  mime: string;
  created: number;
  parts: (string | undefined)[];
  received: number;
  at: number;
}

interface Session {
  roomId: string;
  roomKey: string;
  key: CryptoKey;
  portal: Portal;
  persistent: boolean;
  updateUrl: boolean;
  mode: Mode;
  selfId: string | null;
  joinedOnce: boolean;
  users: Set<string>;
  initialSynced: boolean;
  syncTimeout?: ReturnType<typeof setTimeout>;

  broadcasted: Map<string, number>;
  lastSent: Map<string, ExcalidrawElement>;
  lastOrder: string;
  lastFilesRef: BinaryFiles | null;
  remoteApplied: Map<string, number>;
  sentFiles: Set<string>;
  assemblies: Map<string, FileAssembly>;
  requested: Map<string, { at: number; tried: string[] }>;

  snapshotDirty: boolean;
  lastChangeAt: number;
  lastSnapshotAt: number;

  sendQueue: Promise<unknown>;
  volatileQueue: Promise<unknown>;
  recvQueue: Promise<unknown>;
  recvVolatileQueue: Promise<unknown>;

  flushTimer?: ReturnType<typeof setTimeout>;
  presenceTimer?: ReturnType<typeof setTimeout>;
  lastPresenceAt: number;
  viewportTimer?: ReturnType<typeof setTimeout>;
  lastViewportAt: number;
  collabTimer?: ReturnType<typeof setTimeout>;
  pendingCollaborators: Map<string, Partial<Collaborator>>;
  tick?: ReturnType<typeof setInterval>;
  unsubs: (() => void)[];

  pointer: { x: number; y: number; tool: "pointer" | "laser" } | null;
  pointerDown: boolean;
  lastFollowApplied: { scrollX: number; scrollY: number; zoom: number } | null;
  applying: boolean;
}

let session: Session | null = null;
let starting: Promise<{ link: string; roomId: string; roomKey: string }> | null = null;

const FILE_CHUNK = 900_000;
const MAX_FILE_CHARS = 30 * 1024 * 1024;
const SNAPSHOT_INTERVAL = 20_000;
const SNAPSHOT_INTERVAL_PERSISTENT = 5_000;
const PRESENCE_MS = 33;
const VIEWPORT_MS = 50;
const BACKUP_KEY = "excalimade-pre-collab";

export const isActive = () => !!session;
export const getSelfId = () => session?.selfId ?? null;
export const roomLink = (roomId: string, roomKey: string) => `${location.origin}/#room=${roomId},${roomKey}`;

// ---- username ------------------------------------------------------------------------------

export function getUsername() {
  const st = getState().appState.username?.trim();
  return st || getStoredUsername() || "";
}

export function setUsername(name: string) {
  const clean = name.replace(/\s+/g, " ").slice(0, 40);
  storeUsername(clean);
  getState().setAppState({ username: clean });
  if (session) void sendApp({ t: "hello", u: clean.trim() || "Anonymous", m: mediaState() });
}

function ensureUsername() {
  let name = getUsername();
  if (!name) {
    name = randomUsername();
    storeUsername(name);
  }
  if (getState().appState.username !== name) getState().setAppState({ username: name });
  return name;
}

// ---- encrypted messaging -------------------------------------------------------------------

function sendApp(msg: Record<string, unknown>, opts: { to?: string; volatile?: boolean } = {}): Promise<boolean> {
  const s = session;
  if (!s) return Promise.resolve(false);
  const queueKey = opts.volatile ? "volatileQueue" : "sendQueue";
  const p = s[queueKey].then(async () => {
    if (session !== s || !s.portal.isOpen) return false;
    const payload = await encryptJSON(s.key, msg);
    return s.portal.send(
      { type: opts.volatile ? "volatile" : "broadcast", roomId: s.roomId, payload, ...(opts.to ? { to: opts.to } : {}) },
      opts.volatile,
    );
  });
  s[queueKey] = p.catch(() => false);
  return p.catch((err) => {
    console.warn("[collab] send failed", err);
    return false;
  });
}

// ---- collaborators -------------------------------------------------------------------------

function patchCollaborator(id: string, patch: Partial<Collaborator>) {
  const s = session;
  if (!s) return;
  s.pendingCollaborators.set(id, { ...s.pendingCollaborators.get(id), ...patch });
  if (s.collabTimer) return;
  s.collabTimer = setTimeout(() => flushCollaborators(s), 30);
}

function flushCollaborators(s: Session) {
  s.collabTimer = undefined;
  if (session !== s || !s.pendingCollaborators.size) return;
  const pending = s.pendingCollaborators;
  s.pendingCollaborators = new Map();
  getState().setAppState((as) => {
    const collaborators = { ...as.collaborators };
    for (const [id, patch] of pending) {
      if (!s.users.has(id)) continue;
      const base: Collaborator = collaborators[id] ?? { id, username: "", color: colorForId(id) };
      collaborators[id] = { ...base, ...patch };
    }
    return { collaborators };
  });
}

function removeUser(s: Session, id: string) {
  s.users.delete(id);
  s.pendingCollaborators.delete(id);
  const as = getState().appState;
  const name = as.collaborators[id]?.username;
  if (as.collaborators[id] || as.followingUserId === id) {
    getState().setAppState((st) => {
      const collaborators = { ...st.collaborators };
      delete collaborators[id];
      return { collaborators, followingUserId: st.followingUserId === id ? null : st.followingUserId };
    });
    if (as.followingUserId === id) showToast(`${name || "The user you were following"} left the session`);
  }
  removeCursor(id);
  closePeer(id);
  setCollab((c) => ({ followers: c.followers.filter((f) => f !== id) }));
}

const usernameOf = (id: string) => getState().appState.collaborators[id]?.username || "Someone";

// ---- scene sync ----------------------------------------------------------------------------

const orderKey = (els: readonly ExcalidrawElement[]) => els.map((e) => e.id).join(",");

function isLocallyEditing(s: Session, id: string) {
  const as = getState().appState;
  if (as.editingTextId === id) return true;
  if (s.pointerDown && (as.selectedElementIds[id] || as.editingLinearId === id || as.croppingImageId === id)) return true;
  return false;
}

function markDirty(s: Session) {
  s.snapshotDirty = true;
  s.lastChangeAt = Date.now();
}

function scheduleFlush(s: Session) {
  if (s.flushTimer) return;
  s.flushTimer = setTimeout(() => {
    s.flushTimer = undefined;
    flushChanges(s);
  }, 40);
}

/** Broadcast elements whose version increased since our last broadcast (plus z-order changes and new files). */
function flushChanges(s: Session) {
  if (session !== s || !s.initialSynced || !s.portal.isOpen || !s.selfId) return;
  const { elements, files } = getState();
  const changed: ExcalidrawElement[] = [];
  const after: (string | null)[] = [];
  const present = new Set<string>();
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    present.add(el.id);
    const v = s.broadcasted.get(el.id);
    if (v === undefined || el.version > v) {
      changed.push(el);
      after.push(i > 0 ? elements[i - 1].id : null);
    }
  }
  // elements removed from the array wholesale (e.g. a file was opened) → send tombstones
  for (const [id, last] of s.lastSent) {
    if (present.has(id)) continue;
    s.lastSent.delete(id);
    s.broadcasted.delete(id);
    if (last.isDeleted) continue;
    changed.push({ ...last, isDeleted: true, version: last.version + 1, versionNonce: randomInteger(), updated: Date.now() });
    after.push(null);
  }
  const order = orderKey(elements);
  const orderChanged = order !== s.lastOrder;
  if (changed.length || orderChanged) {
    void sendApp({ t: "scene", elements: changed, after, ...(orderChanged ? { order: elements.map((e) => e.id) } : {}) });
    for (const el of changed) {
      if (!present.has(el.id)) continue;
      s.broadcasted.set(el.id, el.version);
      s.lastSent.set(el.id, el);
    }
    s.lastOrder = order;
  }
  // binary files the room hasn't seen yet
  const candidates = s.lastFilesRef !== files ? elements : changed;
  s.lastFilesRef = files;
  for (const el of candidates) {
    if (el.type !== "image" || el.isDeleted) continue;
    const fileId = (el as ImageElement).fileId;
    const file = fileId ? files[fileId] : undefined;
    if (file && !s.sentFiles.has(fileId)) {
      s.sentFiles.add(fileId);
      sendFile(file);
    }
  }
}

function fullScene() {
  const els = getState().elements;
  return { t: "scene", elements: els, order: els.map((e) => e.id), full: true };
}

function markBroadcasted(s: Session) {
  const els = getState().elements;
  for (const el of els) {
    s.broadcasted.set(el.id, el.version);
    s.lastSent.set(el.id, el);
  }
  s.lastOrder = orderKey(els);
}

function sendFullScene(s: Session, to?: string) {
  void sendApp(fullScene(), { to });
  markBroadcasted(s);
}

function applyRemoteElements(s: Session, remote: unknown[], opts: { after?: unknown; order?: unknown }) {
  const st = getState();
  const after = Array.isArray(opts.after) && opts.after.length === remote.length
    ? (opts.after as unknown[]).map((a) => (typeof a === "string" ? a : null))
    : undefined;
  const order = Array.isArray(opts.order) ? (opts.order as unknown[]).filter((x): x is string => typeof x === "string") : undefined;
  const { elements, accepted, changed } = reconcileElements(st.elements, remote, {
    after,
    order,
    isLocallyEditing: (id) => isLocallyEditing(s, id),
  });
  if (!changed) return;
  s.applying = true;
  try {
    st.setElements(elements);
  } finally {
    s.applying = false;
  }
  for (const a of accepted) {
    s.broadcasted.set(a.id, a.version);
    s.lastSent.set(a.id, a);
    s.remoteApplied.set(a.id, a.version);
  }
  s.lastOrder = orderKey(elements);
  markDirty(s);
  requestMissingFiles(s);
}

/** Join-by-link: the room's scene replaces the local canvas (local scene is backed up first). */
async function completeInitialSync(s: Session, remote: unknown[] | null, files: BinaryFiles | null, order?: unknown) {
  if (s.initialSynced) return;
  clearTimeout(s.syncTimeout);
  if (s.mode === "join") {
    await backupLocalScene();
    if (session !== s) return;
    const st = getState();
    s.applying = true;
    try {
      st.setElements([]);
      st.clearHistory();
      st.setAppState({
        selectedElementIds: {},
        editingTextId: null,
        editingGroupId: null,
        editingLinearId: null,
        croppingImageId: null,
        editingFrameNameId: null,
      });
    } finally {
      s.applying = false;
    }
    s.broadcasted.clear();
    s.lastSent.clear();
  }
  s.initialSynced = true;
  setCollab({ syncing: false });
  if (files) addRemoteFiles(s, files);
  if (remote) applyRemoteElements(s, remote, { order });
  if (s.mode === "join") {
    markBroadcasted(s);
    emit("sceneLoaded", { source: "collab" });
    if (getNonDeletedElements().length) requestAnimationFrame(() => zoomToFit(undefined, { maxZoom: 1 }));
  } else {
    flushChanges(s);
  }
}

// ---- files ---------------------------------------------------------------------------------

function referencedFiles(elements: readonly ExcalidrawElement[], files: BinaryFiles) {
  const out: BinaryFiles = {};
  for (const el of elements) {
    if (el.type !== "image" || el.isDeleted) continue;
    const f = files[(el as ImageElement).fileId];
    if (f) out[f.id] = f;
  }
  return out;
}

const validFile = (f: any): f is BinaryFile =>
  f &&
  typeof f.id === "string" &&
  f.id.length <= 128 &&
  typeof f.mimeType === "string" &&
  typeof f.dataURL === "string" &&
  f.dataURL.startsWith("data:") &&
  f.dataURL.length <= MAX_FILE_CHARS;

function addRemoteFiles(s: Session, files: unknown) {
  if (!files || typeof files !== "object") return;
  const existing = getState().files;
  const add: BinaryFile[] = [];
  for (const f of Object.values(files as Record<string, unknown>)) {
    if (!validFile(f) || existing[f.id]) continue;
    add.push({ id: f.id, mimeType: f.mimeType, dataURL: f.dataURL, created: Number(f.created) || Date.now() });
    s.sentFiles.add(f.id);
    s.requested.delete(f.id);
  }
  if (add.length) getState().addFiles(add);
}

function sendFile(file: BinaryFile, to?: string) {
  const n = Math.max(1, Math.ceil(file.dataURL.length / FILE_CHUNK));
  for (let i = 0; i < n; i++) {
    void sendApp(
      { t: "file", id: file.id, mime: file.mimeType, created: file.created, i, n, d: file.dataURL.slice(i * FILE_CHUNK, (i + 1) * FILE_CHUNK) },
      { to },
    );
  }
}

function onFileChunk(s: Session, msg: any) {
  const { id, mime, created, i, n, d } = msg;
  if (typeof id !== "string" || id.length > 128 || typeof mime !== "string" || typeof d !== "string") return;
  if (!Number.isInteger(n) || !Number.isInteger(i) || n < 1 || n > Math.ceil(MAX_FILE_CHARS / FILE_CHUNK) || i < 0 || i >= n) return;
  if (getState().files[id]) return;
  let a = s.assemblies.get(id);
  if (!a || a.parts.length !== n) {
    a = { mime, created: Number(created) || Date.now(), parts: new Array(n), received: 0, at: Date.now() };
    s.assemblies.set(id, a);
  }
  a.at = Date.now();
  if (a.parts[i] === undefined) {
    a.parts[i] = d;
    a.received++;
  }
  if (a.received < n) return;
  s.assemblies.delete(id);
  addRemoteFiles(s, { [id]: { id, mimeType: a.mime, dataURL: a.parts.join(""), created: a.created } });
}

function requestMissingFiles(s: Session) {
  if (!s.portal.isOpen) return;
  const { elements, files } = getState();
  const peers = [...s.users].sort();
  if (!peers.length) return;
  const now = Date.now();
  const byPeer = new Map<string, string[]>();
  for (const el of elements) {
    if (el.type !== "image" || el.isDeleted) continue;
    const fileId = (el as ImageElement).fileId;
    if (!fileId || files[fileId]) continue;
    const asm = s.assemblies.get(fileId);
    if (asm && now - asm.at < 10_000) continue;
    const req = s.requested.get(fileId) ?? { at: 0, tried: [] };
    if (now - req.at < 8_000) continue;
    const target = peers.find((p) => !req.tried.includes(p));
    if (!target) continue; // everyone asked; wait for a new peer or the snapshot
    req.at = now;
    req.tried.push(target);
    s.requested.set(fileId, req);
    const list = byPeer.get(target) ?? [];
    list.push(fileId);
    byPeer.set(target, list);
  }
  for (const [to, ids] of byPeer) void sendApp({ t: "files-request", ids }, { to });
}

// ---- snapshots -----------------------------------------------------------------------------

const isWriter = (s: Session) => !!s.selfId && [...s.users].every((u) => s.selfId! < u);

async function putSnapshot(s: Session) {
  if (!s.portal.isOpen) return false;
  const { elements, files } = getState();
  const cutoff = Date.now() - 24 * 3600_000;
  const els = elements.filter((e) => !e.isDeleted || e.updated > cutoff);
  s.snapshotDirty = false;
  s.lastSnapshotAt = Date.now();
  try {
    let payload = await encryptJSON(s.key, { elements: els, files: referencedFiles(els, files) }, true);
    if (payload.data.length > 24 * 1024 * 1024) payload = await encryptJSON(s.key, { elements: els, files: {} }, true);
    return s.portal.send({ type: "snapshot-put", roomId: s.roomId, payload, persistent: s.persistent });
  } catch (err) {
    console.warn("[collab] snapshot failed", err);
    s.snapshotDirty = true;
    return false;
  }
}

function onTick(s: Session) {
  if (session !== s) return;
  const now = Date.now();
  if (s.snapshotDirty && s.initialSynced && isWriter(s)) {
    const interval = s.persistent ? SNAPSHOT_INTERVAL_PERSISTENT : SNAPSHOT_INTERVAL;
    if (now - s.lastSnapshotAt >= interval && (now - s.lastChangeAt >= 1000 || now - s.lastSnapshotAt >= 60_000)) {
      void putSnapshot(s);
    }
  }
  for (const [id, a] of s.assemblies) if (now - a.at > 60_000) s.assemblies.delete(id);
  requestMissingFiles(s);
}

// ---- presence / follow ---------------------------------------------------------------------

function selectedIds() {
  return Object.keys(getState().appState.selectedElementIds).slice(0, 500);
}

function schedulePresence(s: Session) {
  if (s.presenceTimer) return;
  const wait = Math.max(0, PRESENCE_MS - (performance.now() - s.lastPresenceAt));
  s.presenceTimer = setTimeout(() => {
    s.presenceTimer = undefined;
    if (session !== s || !s.initialSynced) return;
    s.lastPresenceAt = performance.now();
    void sendApp(
      { t: "presence", u: getUsername() || "Anonymous", p: s.pointer, d: s.pointerDown, s: selectedIds() },
      { volatile: true },
    );
  }, wait);
}

function scheduleViewport(s: Session) {
  if (s.viewportTimer || !getCollab().followers.length) return;
  const wait = Math.max(0, VIEWPORT_MS - (performance.now() - s.lastViewportAt));
  s.viewportTimer = setTimeout(() => {
    s.viewportTimer = undefined;
    if (session !== s || !getCollab().followers.length) return;
    s.lastViewportAt = performance.now();
    const { scrollX, scrollY, zoom, width, height } = getState().appState;
    void sendApp({ t: "viewport", v: { scrollX, scrollY, zoom, width, height } }, { volatile: true });
  }, wait);
}

function applyFollowViewport(s: Session, v: any) {
  const nums = ["scrollX", "scrollY", "zoom", "width", "height"].map((k) => v?.[k]);
  if (!nums.every((n) => typeof n === "number" && Number.isFinite(n)) || v.zoom <= 0 || v.width <= 0 || v.height <= 0) return;
  const { width: W, height: H } = getState().appState;
  const w = v.width / v.zoom;
  const h = v.height / v.zoom;
  const cx = -v.scrollX + w / 2;
  const cy = -v.scrollY + h / 2;
  const zoom = clamp(Math.min(W / w, H / h), MIN_ZOOM, MAX_ZOOM);
  const target = { zoom, scrollX: W / 2 / zoom - cx, scrollY: H / 2 / zoom - cy };
  s.lastFollowApplied = target;
  getState().setAppState(target);
}

function onFollowChange(s: Session, prev: string | null, next: string | null) {
  s.lastFollowApplied = null;
  if (prev && s.users.has(prev)) s.portal.send({ type: "follow", roomId: s.roomId, to: prev, following: false });
  if (next) {
    if (!s.users.has(next)) {
      getState().setAppState({ followingUserId: null });
      return;
    }
    s.portal.send({ type: "follow", roomId: s.roomId, to: next, following: true });
  }
}

export function followUser(id: string | null) {
  getState().setAppState({ followingUserId: id });
}

// ---- incoming ------------------------------------------------------------------------------

function onServerMessage(s: Session, msg: ServerMessage) {
  if (session !== s) return;
  switch (msg.type) {
    case "hello":
      return; // socket id arrives again with "joined"
    case "joined":
      return onJoined(s, msg);
    case "room-users":
      return onRoomUsers(s, msg);
    case "broadcast":
    case "volatile": {
      const from = msg.from;
      if (typeof from !== "string" || !msg.payload) return;
      const key = msg.type === "volatile" ? "recvVolatileQueue" : "recvQueue";
      s[key] = s[key].then(async () => {
        if (session !== s) return;
        let data: any;
        try {
          data = await decryptJSON(s.key, msg.payload as EncryptedPayload);
        } catch {
          return; // wrong key / tampered
        }
        if (session === s && data && typeof data === "object") await onAppMessage(s, from, data);
      }).catch((err) => console.warn("[collab] message failed", err));
      return;
    }
    case "snapshot":
      s.recvQueue = s.recvQueue.then(async () => {
        if (session !== s) return;
        let data: any = null;
        if (msg.payload) {
          try {
            data = await decryptJSON(s.key, msg.payload as EncryptedPayload);
          } catch {
            data = null;
          }
        }
        if (session !== s) return;
        const elements = data && Array.isArray(data.elements) ? (data.elements as unknown[]) : null;
        if (!s.initialSynced) {
          if (elements || !s.users.size) await completeInitialSync(s, elements, data?.files ?? null);
          // otherwise wait for a peer's full scene (with timeout)
          else s.syncTimeout = setTimeout(() => void completeInitialSync(s, null, null), 6000);
        } else if (elements) {
          addRemoteFiles(s, data.files);
          applyRemoteElements(s, elements, {});
          flushChanges(s); // our offline edits go back to the room
        }
      }).catch((err) => console.warn("[collab] snapshot failed", err));
      return;
    case "rtc-signal": {
      const from = msg.from;
      if (typeof from !== "string" || !msg.payload) return;
      s.recvVolatileQueue = s.recvVolatileQueue.then(async () => {
        try {
          const data = await decryptJSON(s.key, msg.payload as EncryptedPayload);
          if (session === s) await handleSignal(from, data);
        } catch {
          /* ignore */
        }
      });
      return;
    }
    case "follow": {
      const from = msg.from;
      if (typeof from !== "string" || !s.users.has(from)) return;
      const followers = getCollab().followers.filter((f) => f !== from);
      if (msg.following) {
        followers.push(from);
        showToast(`${usernameOf(from)} is following you`);
      }
      setCollab({ followers });
      if (msg.following) {
        s.lastViewportAt = 0;
        scheduleViewport(s);
      }
      return;
    }
    case "snapshot-ack":
      return;
    case "error":
      if (msg.code === "room-full") {
        showToast("This collaboration room is full (50 people max).", "error");
        stopSession();
      } else if (msg.code === "too-large") {
        showToast("A change was too large to sync to collaborators.", "error");
      } else if (msg.code === "bad-room") {
        showToast("Invalid collaboration link.", "error");
        stopSession();
      }
      return;
  }
}

function onJoined(s: Session, msg: ServerMessage) {
  if (msg.roomId !== s.roomId || typeof msg.id !== "string") return;
  const reconnect = s.joinedOnce;
  s.joinedOnce = true;
  if (reconnect) closeAllPeers(); // our socket id changed; peers will reconnect to the new one
  s.selfId = msg.id;
  const others: string[] = (Array.isArray(msg.users) ? msg.users : []).filter((u: unknown) => typeof u === "string" && u !== msg.id);
  for (const old of [...s.users]) if (!others.includes(old)) removeUser(s, old);
  s.users = new Set(others);
  setCollab({ selfId: msg.id, users: others, followers: [] });
  for (const u of others) patchCollaborator(u, { id: u, color: colorForId(u) });
  void sendApp({ t: "hello", u: getUsername() || "Anonymous", m: mediaState() });
  if (s.initialSynced && (others.length || getState().elements.length)) sendFullScene(s);
  s.portal.send({ type: "snapshot-get", roomId: s.roomId });
  const following = getState().appState.followingUserId;
  if (following) {
    if (s.users.has(following)) s.portal.send({ type: "follow", roomId: s.roomId, to: following, following: true });
    else getState().setAppState({ followingUserId: null });
  }
  if (s.initialSynced) markDirty(s);
}

function onRoomUsers(s: Session, msg: ServerMessage) {
  if (msg.roomId !== s.roomId || !s.selfId || !Array.isArray(msg.users)) return;
  const others: string[] = msg.users.filter((u: unknown): u is string => typeof u === "string" && u !== s.selfId);
  const prev = [...s.users];
  const added = others.filter((u) => !s.users.has(u));
  for (const old of prev) if (!others.includes(old)) removeUser(s, old);
  // am I one of the two "oldest" (lowest id) existing members responsible for sending the scene?
  const responders = [s.selfId, ...prev.filter((u) => others.includes(u))].sort().slice(0, 2);
  for (const u of added) {
    s.users.add(u);
    patchCollaborator(u, { id: u, color: colorForId(u) });
    void sendApp({ t: "hello", u: getUsername() || "Anonymous", m: mediaState() }, { to: u });
    if (s.initialSynced && responders.includes(s.selfId)) void sendApp(fullScene(), { to: u });
    if (s.pointer) schedulePresence(s);
  }
  setCollab({ users: [...s.users] });
}

async function onAppMessage(s: Session, from: string, m: any) {
  if (!s.users.has(from)) {
    // message raced ahead of room-users; accept it but register the user
    s.users.add(from);
    setCollab({ users: [...s.users] });
  }
  switch (m.t) {
    case "hello": {
      const username = typeof m.u === "string" ? m.u.slice(0, 40) : "";
      patchCollaborator(from, { id: from, username, color: colorForId(from) });
      if (m.m && typeof m.m === "object") {
        const media = { inVoice: !!m.m.inVoice, muted: !!m.m.muted, sharing: !!m.m.sharing };
        patchCollaborator(from, { isMuted: media.inVoice ? media.muted : undefined });
        onPeerMediaState(from, media);
      }
      return;
    }
    case "media": {
      if (!m.m || typeof m.m !== "object") return;
      const media = { inVoice: !!m.m.inVoice, muted: !!m.m.muted, sharing: !!m.m.sharing };
      patchCollaborator(from, { isMuted: media.inVoice ? media.muted : undefined });
      onPeerMediaState(from, media);
      return;
    }
    case "scene": {
      if (!Array.isArray(m.elements)) return;
      if (!s.initialSynced) {
        if (m.full) await completeInitialSync(s, m.elements, null, m.order);
        return; // partial updates before the base scene are covered by the full scene that follows
      }
      applyRemoteElements(s, m.elements, { after: m.after, order: m.order });
      return;
    }
    case "presence": {
      const p = m.p;
      const pointer =
        p && typeof p.x === "number" && typeof p.y === "number" && Number.isFinite(p.x) && Number.isFinite(p.y)
          ? { x: p.x, y: p.y, tool: p.tool === "laser" ? ("laser" as const) : ("pointer" as const) }
          : null;
      updateCursor(from, pointer, !!m.d);
      const patch: Partial<Collaborator> = {
        id: from,
        pointer: pointer ?? undefined,
        selectedElementIds: Array.isArray(m.s) ? m.s.filter((x: unknown) => typeof x === "string").slice(0, 500) : [],
      };
      if (typeof m.u === "string" && m.u) patch.username = m.u.slice(0, 40);
      patchCollaborator(from, patch);
      return;
    }
    case "viewport":
      patchCollaborator(from, { viewport: m.v });
      if (getState().appState.followingUserId === from) applyFollowViewport(s, m.v);
      return;
    case "files-request": {
      if (!Array.isArray(m.ids)) return;
      const files = getState().files;
      for (const id of m.ids.slice(0, 200)) if (typeof id === "string" && files[id]) sendFile(files[id], from);
      return;
    }
    case "file":
      onFileChunk(s, m);
      return;
  }
}

// ---- local store / event subscriptions -----------------------------------------------------

function onStoreChange(s: Session, state: Store, prev: Store) {
  if (session !== s || s.applying) return;
  if (state.elements !== prev.elements) {
    // Undo/redo restores whole snapshots; don't let it revert changes that came from collaborators.
    if (state.undoStack !== prev.undoStack && state.redoStack !== prev.redoStack) {
      const prevById = new Map(prev.elements.map((e) => [e.id, e]));
      let fixed = false;
      const next = state.elements.map((el) => {
        const before = prevById.get(el.id);
        if (!before || before === el) return el;
        if (s.remoteApplied.get(el.id) === before.version) {
          fixed = true;
          return before;
        }
        return el;
      });
      if (fixed) {
        s.applying = true;
        try {
          state.setElements(next);
        } finally {
          s.applying = false;
        }
      }
    }
    if (s.initialSynced) {
      markDirty(s);
      scheduleFlush(s);
    }
  }
  if (state.files !== prev.files && s.initialSynced) scheduleFlush(s);

  const a = state.appState;
  const b = prev.appState;
  if (a === b) return;
  if (a.selectedElementIds !== b.selectedElementIds) schedulePresence(s);
  if (a.followingUserId !== b.followingUserId) onFollowChange(s, b.followingUserId, a.followingUserId);
  const viewportMoved = a.scrollX !== b.scrollX || a.scrollY !== b.scrollY || a.zoom !== b.zoom;
  if (viewportMoved || a.width !== b.width || a.height !== b.height) scheduleViewport(s);
  if (viewportMoved && a.followingUserId && a.followingUserId === b.followingUserId) {
    const f = s.lastFollowApplied;
    const ours = f && f.scrollX === a.scrollX && f.scrollY === a.scrollY && f.zoom === a.zoom;
    if (!ours) getState().setAppState({ followingUserId: null }); // user panned/zoomed themselves
  }
}

function subscribe(s: Session) {
  s.unsubs.push(useStore.subscribe((state, prev) => onStoreChange(s, state, prev)));
  s.unsubs.push(
    on("pointer", ({ x, y, tool, down }) => {
      s.pointer = { x, y, tool: tool === "laser" ? "laser" : "pointer" };
      s.pointerDown = down;
      schedulePresence(s);
    }),
  );
  s.unsubs.push(
    on("pointerLeave", () => {
      s.pointer = null;
      schedulePresence(s);
    }),
  );
  const up = () => {
    if (!s.pointerDown) return;
    s.pointerDown = false;
    schedulePresence(s);
  };
  window.addEventListener("pointerup", up, true);
  window.addEventListener("pointercancel", up, true);
  const hidden = () => {
    if (document.visibilityState === "hidden" && s.snapshotDirty && isWriter(s) && s.initialSynced) void putSnapshot(s);
  };
  document.addEventListener("visibilitychange", hidden);
  s.unsubs.push(() => {
    window.removeEventListener("pointerup", up, true);
    window.removeEventListener("pointercancel", up, true);
    document.removeEventListener("visibilitychange", hidden);
  });
}

// ---- lifecycle -----------------------------------------------------------------------------

initRtc({
  selfId: () => session?.selfId ?? null,
  peers: () => (session ? [...session.users] : []),
  sendSignal: (to, data) => {
    const s = session;
    if (!s) return;
    s.sendQueue = s.sendQueue.then(async () => {
      if (session !== s) return;
      const payload = await encryptJSON(s.key, data);
      s.portal.send({ type: "rtc-signal", roomId: s.roomId, to, payload });
    }).catch(() => {});
  },
  broadcastMediaState: () => void sendApp({ t: "media", m: mediaState() }),
  setSpeaking: (id, speaking) => patchCollaborator(id, { isSpeaking: speaking }),
});

export async function startSession(opts: StartOptions = {}): Promise<{ link: string; roomId: string; roomKey: string }> {
  if (starting) await starting.catch(() => {});
  if (session && (!opts.roomId || opts.roomId === session.roomId)) {
    return { link: roomLink(session.roomId, session.roomKey), roomId: session.roomId, roomKey: session.roomKey };
  }
  if (session) stopSession();
  starting = doStart(opts);
  try {
    return await starting;
  } finally {
    starting = null;
  }
}

async function doStart(opts: StartOptions) {
  const roomId = opts.roomId ?? generateRoomId();
  const roomKey = opts.roomKey ?? (await generateKey());
  if (!ROOM_ID_RE.test(roomId)) throw new Error("Invalid room id");
  if (!ROOM_KEY_RE.test(roomKey)) throw new Error("Invalid room key");
  const key = await importKey(roomKey);
  const mode: Mode = opts.mode ?? (opts.roomId ? "merge" : "create");
  const updateUrl = opts.updateUrl ?? true;
  const persistent = !!opts.persistent;
  ensureUsername();

  const s = {
    roomId,
    roomKey,
    key,
    persistent,
    updateUrl,
    mode,
    selfId: null,
    joinedOnce: false,
    users: new Set<string>(),
    initialSynced: mode !== "join",
    broadcasted: new Map(),
    lastSent: new Map(),
    lastOrder: "",
    lastFilesRef: null,
    remoteApplied: new Map(),
    sentFiles: new Set(),
    assemblies: new Map(),
    requested: new Map(),
    snapshotDirty: mode === "create",
    lastChangeAt: 0,
    lastSnapshotAt: 0,
    sendQueue: Promise.resolve(),
    volatileQueue: Promise.resolve(),
    recvQueue: Promise.resolve(),
    recvVolatileQueue: Promise.resolve(),
    lastPresenceAt: 0,
    lastViewportAt: 0,
    pendingCollaborators: new Map(),
    unsubs: [],
    pointer: null,
    pointerDown: false,
    lastFollowApplied: null,
    applying: false,
  } as Omit<Session, "portal"> as Session;

  session = s;
  const link = roomLink(roomId, roomKey);
  setCollab({
    ...initialCollabState(),
    active: true,
    status: "connecting",
    roomId,
    roomKey,
    link,
    persistent,
    syncing: mode === "join",
  });
  if (updateUrl) history.replaceState(history.state, "", `${location.pathname}${location.search}#room=${roomId},${roomKey}`);

  s.portal = new Portal(
    (msg) => onServerMessage(s, msg),
    (status) => {
      if (session === s) setCollab({ status });
    },
    () => {
      if (session === s) s.portal.send({ type: "join", roomId, persistent });
    },
  );
  subscribe(s);
  s.tick = setInterval(() => onTick(s), 2000);
  return { link, roomId, roomKey };
}

export function stopSession() {
  const s = session;
  if (!s) return;
  session = null;
  clearTimeout(s.flushTimer);
  clearTimeout(s.presenceTimer);
  clearTimeout(s.viewportTimer);
  clearTimeout(s.collabTimer);
  clearTimeout(s.syncTimeout);
  clearInterval(s.tick);
  s.unsubs.forEach((u) => u());
  shutdownRtc();
  clearPresence();

  const finish = () => {
    s.portal.send({ type: "leave", roomId: s.roomId });
    s.portal.close();
  };
  if (s.snapshotDirty && s.initialSynced && isWriter(s) && s.portal.isOpen) {
    // last one out saves the room so late joiners still find the drawing
    const timeout = new Promise((r) => setTimeout(r, 1500));
    void Promise.race([putSnapshot(s), timeout]).finally(finish);
  } else finish();

  getState().setAppState({ collaborators: {}, followingUserId: null });
  setCollab({ ...initialCollabState() });
  if (s.mode === "join" && s.initialSynced) {
    // the joined room's drawing becomes a new scene; the scene that was open before stays untouched
    discardBackup();
    const title = `Live session ${new Date().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`;
    void import("../workspace/store").then((m) => m.saveCanvasAsNewScene(title));
  }
  if (s.updateUrl && location.hash.startsWith("#room=")) {
    history.replaceState(history.state, "", `${location.pathname}${location.search}`);
  }
}

// ---- pre-collab backup ---------------------------------------------------------------------

export function hasBackup() {
  try {
    return !!localStorage.getItem(BACKUP_KEY);
  } catch {
    return false;
  }
}

async function backupLocalScene() {
  const { elements, files } = getState();
  const live = elements.filter((e) => !e.isDeleted);
  if (!live.length) return;
  const save = async (withFiles: boolean) => {
    const json = JSON.stringify({ elements: live, files: withFiles ? referencedFiles(live, files) : {}, savedAt: Date.now() });
    localStorage.setItem(BACKUP_KEY, bytesToBase64(await gzip(json)));
  };
  try {
    await save(true);
  } catch {
    try {
      await save(false);
    } catch {
      /* storage full — nothing we can do */
    }
  }
}

export async function restoreBackup() {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(BACKUP_KEY);
  } catch {
    /* ignore */
  }
  if (!raw) return false;
  try {
    const data = JSON.parse(await gunzip(base64ToBytes(raw)));
    const elements = (Array.isArray(data.elements) ? data.elements : []).filter(isValidElement);
    const st = getState();
    st.recordHistory();
    st.setElements(elements);
    const files = Object.values((data.files ?? {}) as Record<string, unknown>).filter(validFile);
    if (files.length) st.addFiles(files);
    st.setAppState({ selectedElementIds: {} });
    discardBackup();
    emit("sceneLoaded", { source: "local" });
    showToast("Your previous drawing was restored", "success");
    return true;
  } catch {
    showToast("Couldn't restore the previous drawing", "error");
    discardBackup();
    return false;
  }
}

export function discardBackup() {
  try {
    localStorage.removeItem(BACKUP_KEY);
  } catch {
    /* ignore */
  }
}
