// Collab module root: dialogs, live cursors, avatars, follow mode, screen shares and link handling.
import "./collab.css";
import "./actions";
import { useEffect } from "react";
import { getNonDeletedElements, getState, showToast, useStore } from "../core/store";
import { CollabDialog, JoinPrompt } from "./CollabDialog";
import { CursorOverlay } from "./CursorOverlay";
import { Avatars, FollowFrame, ScreenShares, SharedViewBanner } from "./PresenceUI";
import { getCollab, getStoredUsername, setCollab, useCollab } from "./state";
import { startSession } from "./session";
import { loadSharedScene } from "./share";

const ROOM_HASH = /^#room=([a-f0-9]{20,40}),([A-Za-z0-9_-]{22})$/;
const JSON_HASH = /^#json=([a-f0-9]{20}),([A-Za-z0-9_-]{22})$/;

let lastHandled: string | null = null;

async function handleLocation() {
  const hash = location.hash;
  if (`${location.search}${hash}` === lastHandled) return; // StrictMode double-mount
  lastHandled = `${location.search}${hash}`;
  const embed = new URLSearchParams(location.search).get("embed") === "1";
  const room = ROOM_HASH.exec(hash);
  if (room) {
    const [, roomId, roomKey] = room;
    const c = getCollab();
    if (c.active && c.roomId === roomId) return;
    // ask for a name the first time, and always warn before replacing a non-empty canvas
    if (!getStoredUsername() || getNonDeletedElements().length > 0) {
      setCollab({ pendingJoin: { roomId, roomKey } });
      return;
    }
    try {
      await startSession({ roomId, roomKey, mode: "join" });
    } catch (err: any) {
      showToast(`Couldn't join the session: ${err?.message ?? err}`, "error");
    }
    return;
  }
  if (hash.startsWith("#room=")) {
    showToast("This collaboration link is invalid or incomplete.", "error");
    return;
  }
  const json = JSON_HASH.exec(hash);
  if (json) {
    await loadSharedScene(json[1], json[2], embed);
    return;
  }
  if (embed) getState().setAppState({ viewModeEnabled: true, zenModeEnabled: true });
}

export function CollabLayer() {
  const openDialog = useStore((s) => s.appState.openDialog);
  const active = useCollab((s) => s.active);
  const hasCollaborators = useStore((s) => Object.keys(s.appState.collaborators).length > 0);

  useEffect(() => {
    void handleLocation();
    const onHash = () => {
      lastHandled = null;
      void handleLocation();
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return (
    <>
      {(active || hasCollaborators) && <CursorOverlay />}
      <Avatars />
      <FollowFrame />
      <ScreenShares />
      <SharedViewBanner />
      {openDialog === "collab" && <CollabDialog />}
      <JoinPrompt />
    </>
  );
}
