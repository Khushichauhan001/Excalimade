// COLLAB CONTRACT — owned by the collab agent; the cloud module depends on these signatures.
import { getCollab } from "./state";
import { isActive, startSession, stopSession } from "./session";

export interface StartCollabOptions {
  /** Join/create a specific room (e.g. a cloud scene's persistent room). Random if omitted. */
  roomId?: string;
  /** Base64url AES-GCM key. Random if omitted. */
  roomKey?: string;
  /** Persistent rooms keep their encrypted snapshot on the server (tied to saved cloud scenes). */
  persistent?: boolean;
  /** Update the browser URL to the #room=… link (default true; false for cloud scenes that have their own URL). */
  updateUrl?: boolean;
}

/**
 * Start or join a live session. Resolves to the shareable room link.
 * Without `roomId` a new room is created and the local scene is shared into it; with a `roomId`
 * the local scene and the room's scene are merged (newest version of every element wins).
 */
export async function startCollab(opts: StartCollabOptions = {}): Promise<{ link: string; roomId: string; roomKey: string }> {
  return startSession({ ...opts, mode: opts.roomId ? "merge" : "create" });
}

/** Leave the session. The current scene is kept locally. */
export function stopCollab(): void {
  stopSession();
}

export function isCollaborating(): boolean {
  return isActive();
}

/**
 * True while the canvas shows someone else's scene (a joined room or a read-only #json link).
 * Local autosave should pause so it doesn't overwrite the user's own drawing.
 */
export function shouldPauseAutosave(): boolean {
  const c = getCollab();
  return !!c.sharedView || (c.active && !c.persistent);
}

/** True when the page URL is a collab/share link the collab layer will load (skip restoring autosave). */
export function isCollabUrl(): boolean {
  return /^#(room|json)=/.test(location.hash);
}

export { createShareLink, makeEditableCopy } from "./share";
