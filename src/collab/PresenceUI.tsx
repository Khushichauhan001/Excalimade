// Avatar row, follow frame, screen-share panels and the read-only banner.
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { createPortal } from "react-dom";
import { getState, useStore } from "../core/store";
import { useDevice } from "../core/useDevice";
import { colorForId, initials, setCollab, useCollab } from "./state";
import { followUser } from "./session";
import { stopScreenShare } from "./rtc";
import { makeEditableCopy } from "./share";
import { IconClose, IconEye, IconMaximize, IconMic, IconMinimize, IconRestore, IconScreen, IconWifiOff } from "./icons";

const MAX_AVATARS = 4;

function useTopRightSlot(enabled: boolean) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const check = () => {
      const el = document.getElementById("ui-topright-slot");
      setSlot((cur) => (cur === el ? cur : el));
    };
    check();
    const t = setInterval(check, 1000);
    return () => clearInterval(t);
  }, [enabled]);
  return enabled ? slot : null;
}

export function Avatars() {
  const active = useCollab((s) => s.active);
  const users = useCollab((s) => s.users);
  const status = useCollab((s) => s.status);
  const syncing = useCollab((s) => s.syncing);
  const peerMedia = useCollab((s) => s.peerMedia);
  const collaborators = useStore((s) => s.appState.collaborators);
  const following = useStore((s) => s.appState.followingUserId);
  const slot = useTopRightSlot(active);
  if (!active) return null;

  const shown = users.slice(0, MAX_AVATARS);
  const extra = users.length - shown.length;
  const openDialog = () => {
    setCollab({ dialogTab: "live" });
    getState().setAppState({ openDialog: "collab" });
  };

  const content = (
    <div className="cb-avatars">
      {status !== "connected" && (
        <button className={`cb-conn cb-conn--${status}`} onClick={openDialog} title="Collaboration connection">
          <IconWifiOff />
          <span>{status === "offline" ? "Offline" : "Connecting…"}</span>
        </button>
      )}
      {status === "connected" && syncing && (
        <span className="cb-conn cb-conn--connecting">
          <span className="cb-spinner cb-spinner--small" />
          <span>Syncing…</span>
        </span>
      )}
      {shown.map((id) => {
        const c = collaborators[id];
        const name = c?.username || "Joining…";
        const color = colorForId(id);
        const isFollowing = following === id;
        return (
          <button
            key={id}
            className={`cb-avatar cb-avatar--button${c?.isSpeaking ? " cb-avatar--speaking" : ""}${isFollowing ? " cb-avatar--following" : ""}`}
            style={{ background: color, ["--cb-color" as string]: color }}
            title={isFollowing ? `Following ${name} — click to stop` : `${name} — click to follow`}
            aria-label={isFollowing ? `Stop following ${name}` : `Follow ${name}`}
            onClick={() => followUser(isFollowing ? null : id)}
          >
            {initials(name)}
            {peerMedia[id]?.inVoice && (
              <span className={`cb-avatar__mic${peerMedia[id].muted ? " cb-avatar__mic--muted" : ""}`}>
                <IconMic off={peerMedia[id].muted} />
              </span>
            )}
          </button>
        );
      })}
      {extra > 0 && (
        <button className="cb-avatar cb-avatar--button cb-avatar--more" onClick={openDialog} title={`${extra} more`}>
          +{extra}
        </button>
      )}
    </div>
  );
  return slot ? createPortal(content, slot) : <div className="cb-avatars-fallback">{content}</div>;
}

export function FollowFrame() {
  const following = useStore((s) => s.appState.followingUserId);
  const name = useStore((s) => (following ? s.appState.collaborators[following]?.username : ""));
  if (!following) return null;
  const color = colorForId(following);
  return (
    <>
      <div className="cb-follow-frame" style={{ borderColor: color }} aria-hidden="true" />
      <div className="cb-follow-pill" style={{ background: color }}>
        <span>Following {name || "collaborator"}</span>
        <span aria-hidden="true">·</span>
        <button onClick={() => followUser(null)}>Stop</button>
      </div>
    </>
  );
}

function ScreenPanel({ id, stream, index }: { id: string; stream: MediaStream; index: number }) {
  const { isMobile } = useDevice();
  const name = useStore((s) => s.appState.collaborators[id]?.username) || "Collaborator";
  const videoRef = useRef<HTMLVideoElement>(null);
  const [minimised, setMinimised] = useState(false);
  const [rect, setRect] = useState(() => {
    const w = isMobile ? Math.min(window.innerWidth - 32, 360) : 420;
    return { x: Math.max(16, window.innerWidth - w - 16 - index * 24), y: 80 + index * 24, w, h: Math.round(w * 0.5625) + 36 };
  });

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.srcObject = stream;
    v.play().catch(() => {});
  }, [stream, minimised]);

  const drag = (e: RPointerEvent, mode: "move" | "resize") => {
    if ((e.target as HTMLElement).closest("button") && mode === "move") return;
    e.preventDefault();
    e.stopPropagation();
    const start = { px: e.clientX, py: e.clientY, ...rect };
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - start.px;
      const dy = ev.clientY - start.py;
      if (mode === "move") {
        setRect((r) => ({
          ...r,
          x: Math.min(Math.max(start.x + dx, 8 - r.w + 80), window.innerWidth - 80),
          y: Math.min(Math.max(start.y + dy, 8), window.innerHeight - 40),
        }));
      } else {
        setRect((r) => ({ ...r, w: Math.max(200, start.w + dx), h: Math.max(140, start.h + dy) }));
      }
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  const fullscreen = () => {
    const v = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (!v) return;
    if (v.requestFullscreen) v.requestFullscreen().catch(() => {});
    else v.webkitEnterFullscreen?.();
  };

  return (
    <div
      className={`cb-screen${minimised ? " cb-screen--min" : ""}`}
      style={{ left: rect.x, top: rect.y, width: minimised ? 240 : rect.w, height: minimised ? undefined : rect.h }}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="cb-screen__bar" onPointerDown={(e) => drag(e, "move")}>
        <IconScreen />
        <span className="cb-screen__title">{name}'s screen</span>
        <button className="cb-icon-btn cb-icon-btn--small" onClick={() => setMinimised((m) => !m)} title={minimised ? "Restore" : "Minimise"} aria-label={minimised ? "Restore" : "Minimise"}>
          {minimised ? <IconRestore /> : <IconMinimize />}
        </button>
        {!minimised && (
          <button className="cb-icon-btn cb-icon-btn--small" onClick={fullscreen} title="Full screen" aria-label="Full screen">
            <IconMaximize />
          </button>
        )}
        <button
          className="cb-icon-btn cb-icon-btn--small"
          onClick={() => setCollab((s) => ({ hiddenScreens: { ...s.hiddenScreens, [id]: true } }))}
          title="Close"
          aria-label="Close"
        >
          <IconClose />
        </button>
      </div>
      {!minimised && (
        <>
          <video ref={videoRef} className="cb-screen__video" autoPlay playsInline muted onDoubleClick={fullscreen} />
          <div className="cb-screen__resize" onPointerDown={(e) => drag(e, "resize")} aria-hidden="true" />
        </>
      )}
    </div>
  );
}

export function ScreenShares() {
  const screens = useCollab((s) => s.remoteScreens);
  const hidden = useCollab((s) => s.hiddenScreens);
  const sharing = useCollab((s) => s.sharingScreen);
  const visible = Object.entries(screens).filter(([id]) => !hidden[id]);
  return (
    <>
      {visible.map(([id, stream], i) => (
        <ScreenPanel key={`${id}:${stream.id}`} id={id} stream={stream} index={i} />
      ))}
      {sharing && (
        <div className="cb-sharing-pill">
          <span className="cb-rec-dot" />
          You're sharing your screen
          <button onClick={stopScreenShare}>Stop</button>
        </div>
      )}
    </>
  );
}

export function SharedViewBanner() {
  const view = useCollab((s) => s.sharedView);
  if (!view) return null;
  if (view.embed) {
    return (
      <a className="cb-embed-badge" href={`${location.origin}/${location.hash}`} target="_blank" rel="noopener noreferrer">
        Open in Excalimade ↗
      </a>
    );
  }
  return (
    <div className="cb-banner" role="status">
      <IconEye />
      <span>Read-only view</span>
      <span aria-hidden="true">·</span>
      <button onClick={makeEditableCopy}>Make a copy to edit</button>
    </div>
  );
}
