// Tiny cloud session store. Imported eagerly (via register.ts), so keep it free of heavy imports.
import { create } from "zustand";

export interface CloudUser { id: string; email: string; name: string; color: string; createdAt: number }
export interface PublicUser { id: string; name: string; color: string }

export type Permission = "none" | "view" | "edit";
export type Visibility = "private" | "workspace" | "link";
export type WorkspaceRole = "owner" | "admin" | "member" | "viewer";

export interface SceneMeta {
  id: string;
  name: string;
  workspaceId: string | null;
  workspaceName: string | null;
  personalWorkspace: boolean;
  collectionId: string | null;
  collectionName: string | null;
  visibility: Visibility;
  owner: PublicUser | null;
  updatedBy: PublicUser | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  revision: number;
  size: number;
  hasThumb: boolean;
  permission: Permission;
  canManage: boolean;
  canComment: boolean;
  viaLink: boolean;
  room: { roomId: string; roomKey: string } | null;
  share: { viewToken: string | null; editToken: string | null } | null;
  isOwner: boolean;
}

export interface Comment {
  id: string;
  body: string;
  mentions: string[];
  author: PublicUser | null;
  createdAt: number;
  editedAt: number | null;
}

export interface Thread {
  id: string;
  x: number;
  y: number;
  elementId: string | null;
  ox: number;
  oy: number;
  createdBy: PublicUser | null;
  createdAt: number;
  updatedAt: number;
  resolvedAt: number | null;
  resolvedBy: string | null;
  comments: Comment[];
  unread: boolean;
}

export interface VersionInfo {
  id: string;
  name: string | null;
  size: number;
  restoredFrom: number | null;
  createdAt: number;
  hasThumb: boolean;
  author: PublicUser | null;
}

export type SaveStatus = "idle" | "saved" | "unsaved" | "saving" | "offline" | "error" | "view";

/** A comment being composed at a scene point (before the thread exists). */
export interface DraftThread { x: number; y: number; elementId: string | null; ox: number; oy: number }

export type CloudModal =
  | { kind: "share" }
  | { kind: "invite"; token: string }
  | { kind: "account" }
  | { kind: "saveAs" }
  | {
      kind: "confirm";
      title: string;
      message: string;
      confirmLabel: string;
      danger?: boolean;
      extraLabel?: string;
      resolve: (v: boolean | "extra") => void;
    }
  | { kind: "prompt"; title: string; label: string; initial: string; confirmLabel: string; resolve: (v: string | null) => void };

export interface CloudSession {
  user: CloudUser | null;
  userLoaded: boolean;
  /** The cloud scene currently open on the canvas. */
  scene: SceneMeta | null;
  /** Share-link token used to open the current scene (if any). */
  token: string | null;
  status: SaveStatus;
  lastSavedAt: number | null;
  embed: boolean;
  commentMode: boolean;
  threads: Thread[];
  activeThreadId: string | null;
  draft: DraftThread | null;
  commentFilter: "open" | "resolved";
  preview: VersionInfo | null;
  modal: CloudModal | null;
  unreadNotifications: number;
  /** Bumped when dashboard data should be refetched (after saves, moves…). */
  dashboardNonce: number;
  /** After signing in, continue with this (open a scene / accept an invite / save the canvas). */
  pending: { kind: "open"; id: string; token: string | null } | { kind: "invite"; token: string } | { kind: "saveAs" } | null;
}

export const useCloud = create<CloudSession>(() => ({
  user: null,
  userLoaded: false,
  scene: null,
  token: null,
  status: "idle",
  lastSavedAt: null,
  embed: typeof location !== "undefined" && new URLSearchParams(location.search).get("embed") === "1",
  commentMode: false,
  threads: [],
  activeThreadId: null,
  draft: null,
  commentFilter: "open",
  preview: null,
  modal: null,
  unreadNotifications: 0,
  dashboardNonce: 0,
  pending: null,
}));

export const cloud = () => useCloud.getState();
export const setCloud = (patch: Partial<CloudSession> | ((s: CloudSession) => Partial<CloudSession>)) =>
  useCloud.setState(patch as Partial<CloudSession>);
