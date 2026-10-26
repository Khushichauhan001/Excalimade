import { useCallback, useEffect, useState } from "react";
import { getNonDeletedElements, getState, showToast, useStore } from "../core/store";
import { CbDialog } from "./Dialog";
import { useCollab, setCollab, colorForId, initials, getStoredUsername, randomUsername } from "./state";
import {
  discardBackup,
  followUser,
  getUsername,
  hasBackup,
  restoreBackup,
  setUsername,
  startSession,
  stopSession,
} from "./session";
import { createShareLink } from "./share";
import { toggleMute, toggleScreenShare, toggleVoice, MAX_VOICE_PEERS } from "./rtc";
import {
  IconCheck,
  IconCode,
  IconCopy,
  IconHeadphones,
  IconLink,
  IconLock,
  IconMic,
  IconPhoneOff,
  IconScreen,
  IconShare,
  IconUsers,
} from "./icons";

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

function CopyField({ value, label, multiline }: { value: string; label: string; multiline?: boolean }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);
  const copy = async () => {
    if (await copyText(value)) setCopied(true);
    else showToast("Couldn't copy — select the text and copy it manually.", "error");
  };
  const canShare = typeof navigator.share === "function" && !multiline && window.matchMedia("(pointer: coarse)").matches;
  return (
    <div className="cb-field">
      <span className="cb-label">{label}</span>
      <div className="cb-copy-row">
        {multiline ? (
          <textarea className="cb-input cb-input--code" readOnly value={value} rows={3} onFocus={(e) => e.currentTarget.select()} />
        ) : (
          <input className="cb-input" readOnly value={value} onFocus={(e) => e.currentTarget.select()} aria-label={label} />
        )}
        <button className="cb-btn cb-btn--primary cb-copy-btn" onClick={copy}>
          {copied ? <IconCheck /> : <IconCopy />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
        {canShare && (
          <button
            className="cb-btn cb-btn--icon"
            title="Share"
            aria-label="Share link"
            onClick={() => navigator.share({ title: "Excalimade", url: value }).catch(() => {})}
          >
            <IconShare />
          </button>
        )}
      </div>
    </div>
  );
}

function Avatar({ name, color, speaking, size = 32 }: { name: string; color: string; speaking?: boolean; size?: number }) {
  return (
    <span
      className={`cb-avatar${speaking ? " cb-avatar--speaking" : ""}`}
      style={{ background: color, width: size, height: size, ["--cb-color" as string]: color }}
    >
      {initials(name)}
    </span>
  );
}

function BackupCard() {
  const [visible, setVisible] = useState(hasBackup);
  if (!visible) return null;
  return (
    <div className="cb-card">
      <div className="cb-card__text">
        <strong>Your drawing from before the session is saved.</strong>
        <span>Joining a room replaced your canvas. You can bring your previous drawing back.</span>
      </div>
      <div className="cb-row">
        <button
          className="cb-btn cb-btn--primary"
          onClick={async () => {
            await restoreBackup();
            setVisible(false);
          }}
        >
          Restore
        </button>
        <button
          className="cb-btn"
          onClick={() => {
            discardBackup();
            setVisible(false);
          }}
        >
          Discard
        </button>
      </div>
    </div>
  );
}

function NameField() {
  const stored = useStore((s) => s.appState.username);
  const [value, setValue] = useState(() => stored || getUsername());
  return (
    <label className="cb-field">
      <span className="cb-label">Your name</span>
      <input
        className="cb-input"
        value={value}
        maxLength={40}
        placeholder="Your name"
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => setUsername(value.trim() || randomUsername())}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
      />
    </label>
  );
}

function Participants() {
  const users = useCollab((s) => s.users);
  const selfId = useCollab((s) => s.selfId);
  const peerMedia = useCollab((s) => s.peerMedia);
  const followers = useCollab((s) => s.followers);
  const inVoice = useCollab((s) => s.inVoice);
  const muted = useCollab((s) => s.muted);
  const selfSpeaking = useCollab((s) => s.selfSpeaking);
  const collaborators = useStore((s) => s.appState.collaborators);
  const following = useStore((s) => s.appState.followingUserId);
  const username = useStore((s) => s.appState.username);

  return (
    <div className="cb-field">
      <span className="cb-label">
        In this room · {users.length + 1}
      </span>
      <ul className="cb-people">
        <li className="cb-person">
          <Avatar name={username || "You"} color={selfId ? colorForId(selfId) : "var(--color-primary)"} speaking={selfSpeaking && !muted} />
          <span className="cb-person__name">
            {username || "You"} <span className="cb-muted">(you)</span>
          </span>
          {inVoice && <span className="cb-person__icon" title={muted ? "Muted" : "In voice"}><IconMic off={muted} /></span>}
        </li>
        {users.map((id) => {
          const c = collaborators[id];
          const name = c?.username || "Joining…";
          const media = peerMedia[id];
          return (
            <li key={id} className="cb-person">
              <Avatar name={name} color={colorForId(id)} speaking={c?.isSpeaking} />
              <span className="cb-person__name">
                {name}
                {followers.includes(id) && <span className="cb-badge">following you</span>}
              </span>
              {media?.sharing && <span className="cb-person__icon" title="Sharing screen"><IconScreen /></span>}
              {media?.inVoice && <span className="cb-person__icon" title={media.muted ? "Muted" : "In voice"}><IconMic off={media.muted} /></span>}
              <button
                className={`cb-btn cb-btn--small${following === id ? " cb-btn--active" : ""}`}
                onClick={() => followUser(following === id ? null : id)}
              >
                {following === id ? "Following" : "Follow"}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function VoiceControls() {
  const inVoice = useCollab((s) => s.inVoice);
  const muted = useCollab((s) => s.muted);
  const sharing = useCollab((s) => s.sharingScreen);
  const peerMedia = useCollab((s) => s.peerMedia);
  const inCall = Object.values(peerMedia).filter((m) => m.inVoice).length;
  const canShareScreen = typeof navigator.mediaDevices?.getDisplayMedia === "function";
  return (
    <div className="cb-field">
      <span className="cb-label">
        Voice hangout {inCall > 0 && <span className="cb-muted">· {inCall} {inCall === 1 ? "person" : "people"} talking</span>}
      </span>
      <div className="cb-row cb-row--wrap">
        <button
          className={`cb-btn${inVoice ? " cb-btn--danger-soft" : ""}`}
          onClick={toggleVoice}
          disabled={!inVoice && inCall >= MAX_VOICE_PEERS}
        >
          {inVoice ? <IconPhoneOff /> : <IconHeadphones />}
          {inVoice ? "Leave voice" : "Join voice"}
        </button>
        {inVoice && (
          <button className={`cb-btn${muted ? " cb-btn--active" : ""}`} onClick={toggleMute} aria-pressed={muted}>
            <IconMic off={muted} />
            {muted ? "Unmute" : "Mute"}
          </button>
        )}
        {canShareScreen && (
          <button className={`cb-btn${sharing ? " cb-btn--active" : ""}`} onClick={toggleScreenShare} aria-pressed={sharing}>
            <IconScreen />
            {sharing ? "Stop sharing" : "Share screen"}
          </button>
        )}
      </div>
    </div>
  );
}

function LiveTab() {
  const active = useCollab((s) => s.active);
  const link = useCollab((s) => s.link);
  const status = useCollab((s) => s.status);
  const syncing = useCollab((s) => s.syncing);
  const persistent = useCollab((s) => s.persistent);
  const [starting, setStarting] = useState(false);

  const start = async () => {
    setStarting(true);
    try {
      await startSession({ mode: "create" });
    } catch (err: any) {
      showToast(`Couldn't start the session: ${err?.message ?? err}`, "error");
    } finally {
      setStarting(false);
    }
  };

  if (!active) {
    return (
      <div className="cb-intro">
        <div className="cb-hero" aria-hidden="true">
          <IconUsers />
        </div>
        <h3 className="cb-heading">Invite people to collaborate on your drawing</h3>
        <p className="cb-text">
          Don't worry, the session is end-to-end encrypted and fully private. Not even our server can see what you draw.
        </p>
        <button className="cb-btn cb-btn--primary cb-btn--large" onClick={start} disabled={starting}>
          {starting ? <span className="cb-spinner" /> : <IconLink />}
          {starting ? "Starting…" : "Start session"}
        </button>
        <BackupCard />
      </div>
    );
  }

  return (
    <div className="cb-stack">
      <div className={`cb-status cb-status--${syncing ? "connecting" : status}`}>
        <span className="cb-status__dot" />
        {syncing
          ? "Loading the shared scene…"
          : status === "connected"
            ? "Connected"
            : status === "offline"
              ? "Offline — your changes will sync when you reconnect"
              : status === "reconnecting"
                ? "Reconnecting…"
                : "Connecting…"}
      </div>
      <NameField />
      {link && <CopyField value={link} label="Link" />}
      <p className="cb-note">
        <IconLock /> End-to-end encrypted. The server never sees your drawing{persistent ? " · linked to a saved scene" : ""}.
      </p>
      <Participants />
      <VoiceControls />
      <hr className="cb-divider" />
      <p className="cb-text cb-text--small">
        Stopping the session will disconnect you from the room, but you'll be able to continue working with the scene
        locally. This won't affect other people — they can keep collaborating on their version.
      </p>
      <div className="cb-row cb-row--center">
        <button className="cb-btn cb-btn--danger" onClick={stopSession}>
          Stop session
        </button>
      </div>
    </div>
  );
}

function ShareTab() {
  const shareLink = useCollab((s) => s.shareLink);
  const busy = useCollab((s) => s.shareBusy);
  const empty = useStore((s) => !s.elements.some((e) => !e.isDeleted));
  return (
    <div className="cb-stack">
      <div className="cb-intro cb-intro--compact">
        <div className="cb-hero" aria-hidden="true">
          <IconLink />
        </div>
        <h3 className="cb-heading">Share a read-only link</h3>
        <p className="cb-text">
          Anyone with the link can view a snapshot of the current scene. It's encrypted in your browser and the key is
          part of the link, so only people you send it to can open it. Later edits aren't included — create a new link
          to share them.
        </p>
      </div>
      {shareLink ? (
        <>
          <CopyField value={shareLink.link} label="Read-only link" />
          <CopyField value={shareLink.embed} label="Embed code" multiline />
          <div className="cb-row cb-row--center">
            <button className="cb-btn" onClick={() => void createShareLink()} disabled={busy}>
              {busy ? <span className="cb-spinner" /> : <IconLink />}
              Create a new link
            </button>
          </div>
        </>
      ) : (
        <div className="cb-row cb-row--center">
          <button className="cb-btn cb-btn--primary cb-btn--large" onClick={() => void createShareLink()} disabled={busy || empty}>
            {busy ? <span className="cb-spinner" /> : <IconCode />}
            {busy ? "Creating link…" : empty ? "Canvas is empty" : "Create link"}
          </button>
        </div>
      )}
    </div>
  );
}

export function CollabDialog() {
  const tab = useCollab((s) => s.dialogTab);
  const close = useCallback(() => getState().setAppState({ openDialog: null }), []);
  return (
    <CbDialog title={tab === "live" ? "Live collaboration" : "Share"} onClose={close} size="regular">
      <div className="cb-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "live"} className={`cb-tab${tab === "live" ? " cb-tab--active" : ""}`} onClick={() => setCollab({ dialogTab: "live" })}>
          <IconUsers /> Live collaboration
        </button>
        <button role="tab" aria-selected={tab === "share"} className={`cb-tab${tab === "share" ? " cb-tab--active" : ""}`} onClick={() => setCollab({ dialogTab: "share" })}>
          <IconLink /> Read-only link
        </button>
      </div>
      {tab === "live" ? <LiveTab /> : <ShareTab />}
    </CbDialog>
  );
}

/** Shown when opening a #room= link without a stored name, or over a non-empty canvas. */
export function JoinPrompt() {
  const pending = useCollab((s) => s.pendingJoin);
  const [name, setName] = useState(() => getStoredUsername() || randomUsername());
  const [joining, setJoining] = useState(false);
  const hasDrawing = getNonDeletedElements().length > 0;
  if (!pending) return null;

  const cancel = () => {
    setCollab({ pendingJoin: null });
    if (location.hash.startsWith("#room=")) history.replaceState(history.state, "", location.pathname + location.search);
  };
  const join = async () => {
    setJoining(true);
    setUsername(name.trim() || randomUsername());
    try {
      await startSession({ roomId: pending.roomId, roomKey: pending.roomKey, mode: "join" });
      setCollab({ pendingJoin: null });
    } catch (err: any) {
      showToast(`Couldn't join: ${err?.message ?? err}`, "error");
      cancel();
    } finally {
      setJoining(false);
    }
  };

  return (
    <CbDialog title="Join live collaboration" onClose={cancel} size="small">
      <div className="cb-stack">
        <p className="cb-text">You've been invited to a live, end-to-end encrypted drawing session.</p>
        <label className="cb-field">
          <span className="cb-label">Your name</span>
          <input
            className="cb-input"
            value={name}
            maxLength={40}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !joining && void join()}
          />
        </label>
        {hasDrawing && (
          <div className="cb-warning">
            Your current drawing will be replaced by the shared scene. We'll keep a backup that you can restore after
            leaving the session.
          </div>
        )}
        <div className="cb-row cb-row--end">
          <button className="cb-btn" onClick={cancel}>
            Cancel
          </button>
          <button className="cb-btn cb-btn--primary" onClick={() => void join()} disabled={joining}>
            {joining && <span className="cb-spinner" />}
            Join session
          </button>
        </div>
      </div>
    </CbDialog>
  );
}

export { Avatar };
