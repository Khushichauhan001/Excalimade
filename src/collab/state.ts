// Collab-only UI state (separate from the scene store so cursor traffic doesn't re-render the app).
import { create } from "zustand";
import type { PortalStatus } from "./portal";

export interface PeerMediaState {
  inVoice: boolean;
  muted: boolean;
  sharing: boolean;
}

export interface CollabState {
  active: boolean;
  status: PortalStatus | "idle";
  roomId: string | null;
  roomKey: string | null;
  link: string | null;
  persistent: boolean;
  selfId: string | null;
  /** Other users currently in the room (socket ids). */
  users: string[];
  /** Waiting for the room's scene after joining via a link. */
  syncing: boolean;

  // voice / screen
  inVoice: boolean;
  muted: boolean;
  sharingScreen: boolean;
  selfSpeaking: boolean;
  peerMedia: Record<string, PeerMediaState>;
  remoteScreens: Record<string, MediaStream>;
  hiddenScreens: Record<string, true>;

  // follow
  followers: string[];

  // dialog / prompts
  dialogTab: "live" | "share";
  pendingJoin: { roomId: string; roomKey: string } | null;
  /** A pre-collab local scene was backed up and can be restored after stopping. */
  restoreOffer: boolean;

  // read-only share link view
  sharedView: null | { embed: boolean };
  shareLink: { link: string; embed: string } | null;
  shareBusy: boolean;
}

export const initialCollabState = (): Omit<CollabState, "dialogTab" | "pendingJoin" | "restoreOffer" | "sharedView" | "shareLink" | "shareBusy"> => ({
  active: false,
  status: "idle",
  roomId: null,
  roomKey: null,
  link: null,
  persistent: false,
  selfId: null,
  users: [],
  syncing: false,
  inVoice: false,
  muted: false,
  sharingScreen: false,
  selfSpeaking: false,
  peerMedia: {},
  remoteScreens: {},
  hiddenScreens: {},
  followers: [],
});

export const useCollab = create<CollabState>(() => ({
  ...initialCollabState(),
  dialogTab: "live",
  pendingJoin: null,
  restoreOffer: false,
  sharedView: null,
  shareLink: null,
  shareBusy: false,
}));

export const getCollab = () => useCollab.getState();
export const setCollab = (patch: Partial<CollabState> | ((s: CollabState) => Partial<CollabState>)) =>
  useCollab.setState(patch);

// ---- identity helpers ----------------------------------------------------------------------

const COLORS = ["#e03131", "#2f9e44", "#1971c2", "#f08c00", "#9c36b5", "#0c8599", "#e8590c", "#c2255c", "#5f3dc4", "#66a80f"];

export function colorForId(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

export const initials = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const USERNAME_KEY = "excalimade-collab-username";
const ADJECTIVES = ["Curious", "Sunny", "Brave", "Clever", "Gentle", "Lucky", "Swift", "Quiet", "Witty", "Jolly", "Calm", "Bright", "Bold", "Merry", "Nimble"];
const ANIMALS = ["Otter", "Panda", "Fox", "Koala", "Owl", "Dolphin", "Lynx", "Penguin", "Badger", "Falcon", "Turtle", "Hedgehog", "Raccoon", "Heron", "Llama"];

export const randomUsername = () =>
  `${ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]} ${ANIMALS[Math.floor(Math.random() * ANIMALS.length)]}`;

export function getStoredUsername(): string | null {
  try {
    const v = localStorage.getItem(USERNAME_KEY);
    return v && v.trim() ? v.trim().slice(0, 40) : null;
  } catch {
    return null;
  }
}
export function storeUsername(name: string) {
  try {
    localStorage.setItem(USERNAME_KEY, name.trim().slice(0, 40));
  } catch {
    /* private mode */
  }
}
