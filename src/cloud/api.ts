// Thin fetch wrapper for the cloud REST API.
import type { CloudUser, PublicUser, SceneMeta, Thread, VersionInfo, Visibility, WorkspaceRole } from "./session";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** status 0 = network failure (offline / server down). */
export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "You're offline or the server can't be reached");
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

export const withToken = (path: string, token: string | null) =>
  token ? `${path}${path.includes("?") ? "&" : "?"}t=${encodeURIComponent(token)}` : path;

export interface Workspace {
  id: string;
  name: string;
  personal: boolean;
  role: WorkspaceRole;
  memberCount: number;
  createdAt: number;
}
export interface Member extends PublicUser {
  email: string;
  role: WorkspaceRole;
  joinedAt: number;
}
export interface Collection { id: string; name: string; createdAt: number; sceneCount: number }
export interface SceneListItem {
  id: string;
  name: string;
  collectionId: string | null;
  visibility: Visibility;
  owner: PublicUser | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  size: number;
  hasThumb: boolean;
}
export interface Notification {
  id: string;
  kind: "mention" | "reply";
  sceneId: string;
  sceneName: string;
  threadId: string;
  commentId: string;
  actor: PublicUser | null;
  snippet: string;
  createdAt: number;
  read: boolean;
}
export interface AccessPerson extends PublicUser {
  email: string;
  workspaceRole: WorkspaceRole;
  override: "none" | "view" | "edit" | null;
  isOwner: boolean;
  effective: "none" | "view" | "edit";
}

export const Api = {
  me: () => api<{ user: CloudUser | null }>("GET", "/api/me"),
  updateMe: (patch: { name?: string; color?: string; currentPassword?: string; newPassword?: string }) =>
    api<{ user: CloudUser }>("PATCH", "/api/me", patch),
  signIn: (email: string, password: string) => api<{ user: CloudUser }>("POST", "/api/auth/signin", { email, password }),
  signUp: (name: string, email: string, password: string) =>
    api<{ user: CloudUser }>("POST", "/api/auth/signup", { name, email, password }),
  signOut: () => api("POST", "/api/auth/signout", {}),

  workspaces: () => api<{ workspaces: Workspace[] }>("GET", "/api/cloud/workspaces"),
  createWorkspace: (name: string) => api<{ workspace: Workspace }>("POST", "/api/cloud/workspaces", { name }),
  renameWorkspace: (id: string, name: string) => api("PATCH", `/api/cloud/workspaces/${id}`, { name }),
  deleteWorkspace: (id: string) => api("DELETE", `/api/cloud/workspaces/${id}`),
  members: (id: string) =>
    api<{ members: Member[]; invite: { token: string | null; role: WorkspaceRole } | null }>("GET", `/api/cloud/workspaces/${id}/members`),
  addMember: (id: string, email: string, role: WorkspaceRole) => api("POST", `/api/cloud/workspaces/${id}/members`, { email, role }),
  setMemberRole: (id: string, userId: string, role: WorkspaceRole) =>
    api("PATCH", `/api/cloud/workspaces/${id}/members/${userId}`, { role }),
  removeMember: (id: string, userId: string) => api("DELETE", `/api/cloud/workspaces/${id}/members/${userId}`),
  updateInvite: (id: string, opts: { role?: WorkspaceRole; regenerate?: boolean; disable?: boolean }) =>
    api<{ invite: { token: string | null; role: WorkspaceRole } }>("POST", `/api/cloud/workspaces/${id}/invite`, opts),
  peekInvite: (token: string) =>
    api<{ workspace: { id: string; name: string; memberCount: number }; role: WorkspaceRole; alreadyMember: boolean }>(
      "GET",
      `/api/cloud/invites/${encodeURIComponent(token)}`,
    ),
  acceptInvite: (token: string) => api<{ workspace: Workspace }>("POST", `/api/cloud/invites/${encodeURIComponent(token)}/accept`, {}),

  collections: (wsId: string) => api<{ collections: Collection[] }>("GET", `/api/cloud/workspaces/${wsId}/collections`),
  createCollection: (wsId: string, name: string) =>
    api<{ collection: Collection }>("POST", `/api/cloud/workspaces/${wsId}/collections`, { name }),
  renameCollection: (id: string, name: string) => api("PATCH", `/api/cloud/collections/${id}`, { name }),
  deleteCollection: (id: string) => api("DELETE", `/api/cloud/collections/${id}`),

  scenes: (wsId: string, q: { collection?: string | null; q?: string; sort?: string; trash?: boolean }) => {
    const p = new URLSearchParams();
    if (q.collection) p.set("collection", q.collection);
    if (q.q) p.set("q", q.q);
    if (q.sort) p.set("sort", q.sort);
    if (q.trash) p.set("trash", "1");
    return api<{ scenes: SceneListItem[]; trashTtlDays: number }>("GET", `/api/cloud/workspaces/${wsId}/scenes?${p}`);
  },
  createScene: (body: { workspaceId: string; collectionId?: string | null; name: string; scene: unknown; thumb?: string | null }) =>
    api<{ scene: SceneMeta }>("POST", "/api/cloud/scenes", body),
  scene: (id: string, token: string | null) => api<{ scene: SceneMeta }>("GET", withToken(`/api/cloud/scenes/${id}`, token)),
  sceneData: (id: string, token: string | null) => api<any>("GET", withToken(`/api/cloud/scenes/${id}/data`, token)),
  saveScene: (
    id: string,
    token: string | null,
    body: { scene: unknown; thumb?: string | null; explicit?: boolean; versionName?: string | null; restoredFrom?: number | null },
  ) => api<{ revision: number; updatedAt: number; versionId: string | null }>("PUT", withToken(`/api/cloud/scenes/${id}/data`, token), body),
  updateScene: (id: string, token: string | null, patch: { name?: string; collectionId?: string | null; workspaceId?: string; visibility?: Visibility }) =>
    api<{ scene: SceneMeta }>("PATCH", withToken(`/api/cloud/scenes/${id}`, token), patch),
  share: (id: string, link: "view" | "edit", action: "enable" | "regenerate" | "revoke") =>
    api<{ scene: SceneMeta }>("POST", `/api/cloud/scenes/${id}/share`, { link, action }),
  access: (id: string) => api<{ people: AccessPerson[] }>("GET", `/api/cloud/scenes/${id}/access`),
  setAccess: (id: string, userId: string, role: "default" | "none" | "view" | "edit") =>
    api("PUT", `/api/cloud/scenes/${id}/access/${userId}`, { role }),
  duplicate: (id: string, token: string | null, workspaceId?: string) =>
    api<{ scene: SceneMeta }>("POST", withToken(`/api/cloud/scenes/${id}/duplicate`, token), workspaceId ? { workspaceId } : {}),
  trash: (id: string) => api("DELETE", `/api/cloud/scenes/${id}`),
  restore: (id: string) => api("POST", `/api/cloud/scenes/${id}/restore`, {}),
  destroy: (id: string) => api("DELETE", `/api/cloud/scenes/${id}?permanent=1`),
  people: (id: string, token: string | null) => api<{ people: PublicUser[] }>("GET", withToken(`/api/cloud/scenes/${id}/people`, token)),

  versions: (id: string, token: string | null) =>
    api<{ versions: VersionInfo[]; keep: number }>("GET", withToken(`/api/cloud/scenes/${id}/versions`, token)),
  versionData: (id: string, vid: string, token: string | null) =>
    api<any>("GET", withToken(`/api/cloud/scenes/${id}/versions/${vid}/data`, token)),
  nameVersion: (id: string, vid: string, name: string | null, token: string | null) =>
    api("PATCH", withToken(`/api/cloud/scenes/${id}/versions/${vid}`, token), { name }),
  createVersion: (id: string, name: string | null, token: string | null) =>
    api<{ versionId: string }>("POST", withToken(`/api/cloud/scenes/${id}/versions`, token), { name }),
  deleteVersion: (id: string, vid: string) => api("DELETE", `/api/cloud/scenes/${id}/versions/${vid}`),

  threads: (id: string, token: string | null) => api<{ threads: Thread[] }>("GET", withToken(`/api/cloud/scenes/${id}/threads`, token)),
  createThread: (
    id: string,
    token: string | null,
    body: { x: number; y: number; elementId: string | null; ox: number; oy: number; body: string; mentions: string[] },
  ) => api<{ thread: Thread }>("POST", withToken(`/api/cloud/scenes/${id}/threads`, token), body),
  updateThread: (tid: string, token: string | null, patch: Record<string, unknown>) =>
    api<{ thread: Thread }>("PATCH", withToken(`/api/cloud/threads/${tid}`, token), patch),
  deleteThread: (tid: string, token: string | null) => api("DELETE", withToken(`/api/cloud/threads/${tid}`, token)),
  reply: (tid: string, token: string | null, body: string, mentions: string[]) =>
    api<{ thread: Thread }>("POST", withToken(`/api/cloud/threads/${tid}/comments`, token), { body, mentions }),
  markRead: (tid: string, token: string | null) => api("POST", withToken(`/api/cloud/threads/${tid}/read`, token), {}),
  editComment: (cid: string, token: string | null, body: string, mentions: string[]) =>
    api<{ thread: Thread }>("PATCH", withToken(`/api/cloud/comments/${cid}`, token), { body, mentions }),
  deleteComment: (cid: string, token: string | null) =>
    api<{ thread?: Thread; threadDeleted?: boolean }>("DELETE", withToken(`/api/cloud/comments/${cid}`, token)),

  notifications: () => api<{ items: Notification[]; unread: number }>("GET", "/api/notifications"),
  readNotifications: (ids?: string[]) => api("POST", "/api/notifications/read", ids ? { ids } : {}),
};

export const thumbUrl = (sceneId: string, updatedAt: number, token?: string | null) =>
  withToken(`/api/cloud/scenes/${sceneId}/thumb?v=${updatedAt}`, token ?? null);
export const versionThumbUrl = (sceneId: string, vid: string, token?: string | null) =>
  withToken(`/api/cloud/scenes/${sceneId}/versions/${vid}/thumb`, token ?? null);
