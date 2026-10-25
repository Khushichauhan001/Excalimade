// Voice hangouts + screen sharing over a WebRTC mesh. Signaling goes through the (encrypted) room socket.
import { showToast } from "../core/store";
import { getCollab, setCollab, type PeerMediaState } from "./state";

export const MAX_VOICE_PEERS = 8;
const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

export interface RtcHost {
  selfId(): string | null;
  /** Other users in the room. */
  peers(): string[];
  sendSignal(to: string, data: unknown): void;
  /** Tell the room about our inVoice / muted / sharing state. */
  broadcastMediaState(): void;
  setSpeaking(id: string, speaking: boolean): void;
}

interface Peer {
  id: string;
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  micSender: RTCRtpSender | null;
  screenSender: RTCRtpSender | null;
  audioEl: HTMLAudioElement | null;
  stopMeter: (() => void) | null;
}

let host: RtcHost | null = null;
const peers = new Map<string, Peer>();
let micStream: MediaStream | null = null;
let screenStream: MediaStream | null = null;
let stopSelfMeter: (() => void) | null = null;
let audioCtx: AudioContext | null = null;
let audioRoot: HTMLDivElement | null = null;

export const initRtc = (h: RtcHost) => {
  host = h;
};

export const mediaState = (): PeerMediaState => {
  const s = getCollab();
  return { inVoice: s.inVoice, muted: s.muted, sharing: s.sharingScreen };
};

// ---- speaking detection ---------------------------------------------------------------------

function getAudioCtx() {
  if (!audioCtx) {
    const Ctor = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!Ctor) return null;
    audioCtx = new Ctor() as AudioContext;
  }
  if (audioCtx.state === "suspended") void audioCtx.resume().catch(() => {});
  return audioCtx;
}

/** Polls an analyser on the stream and reports speaking on/off changes (with a short hold). */
function meter(stream: MediaStream, onChange: (speaking: boolean) => void): () => void {
  const ctx = getAudioCtx();
  if (!ctx || !stream.getAudioTracks().length) return () => {};
  let source: MediaStreamAudioSourceNode;
  try {
    source = ctx.createMediaStreamSource(stream);
  } catch {
    return () => {};
  }
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const buf = new Uint8Array(analyser.fftSize);
  let speaking = false;
  let lastLoud = 0;
  const timer = setInterval(() => {
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / buf.length);
    const now = performance.now();
    if (rms > 0.035) lastLoud = now;
    const next = now - lastLoud < 350;
    if (next !== speaking) {
      speaking = next;
      onChange(next);
    }
  }, 90);
  return () => {
    clearInterval(timer);
    try {
      source.disconnect();
    } catch {
      /* ignore */
    }
    if (speaking) onChange(false);
  };
}

// ---- peer connections -----------------------------------------------------------------------

function ensurePeer(id: string): Peer {
  let p = peers.get(id);
  if (p) return p;
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const self = host?.selfId() ?? "";
  p = {
    id,
    pc,
    polite: self > id,
    makingOffer: false,
    ignoreOffer: false,
    micSender: null,
    screenSender: null,
    audioEl: null,
    stopMeter: null,
  };
  const peer = p;
  peers.set(id, peer);

  pc.onnegotiationneeded = async () => {
    try {
      peer.makingOffer = true;
      await pc.setLocalDescription();
      if (pc.localDescription) host?.sendSignal(id, { description: pc.localDescription.toJSON() });
    } catch (err) {
      console.warn("[collab] negotiation failed", err);
    } finally {
      peer.makingOffer = false;
    }
  };
  pc.onicecandidate = ({ candidate }) => {
    if (candidate) host?.sendSignal(id, { candidate: candidate.toJSON() });
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed") {
      try {
        pc.restartIce();
      } catch {
        /* older browsers */
      }
    }
  };
  pc.ontrack = ({ track, streams }) => {
    const stream = streams[0] ?? new MediaStream([track]);
    if (track.kind === "audio") attachAudio(peer, stream);
    else if (track.kind === "video") {
      setCollab((s) => {
        const hidden = { ...s.hiddenScreens };
        delete hidden[id];
        return { remoteScreens: { ...s.remoteScreens, [id]: stream }, hiddenScreens: hidden };
      });
      track.addEventListener("ended", () => removeRemoteScreen(id, stream));
    }
  };
  return peer;
}

function attachAudio(peer: Peer, stream: MediaStream) {
  detachAudio(peer);
  if (!audioRoot) {
    audioRoot = document.createElement("div");
    audioRoot.style.display = "none";
    audioRoot.setAttribute("aria-hidden", "true");
    document.body.appendChild(audioRoot);
  }
  const el = document.createElement("audio");
  el.autoplay = true;
  el.srcObject = stream;
  audioRoot.appendChild(el);
  el.play().catch(() => showToast("Click anywhere to enable voice audio", "info"));
  peer.audioEl = el;
  peer.stopMeter = meter(stream, (speaking) => host?.setSpeaking(peer.id, speaking));
}

function detachAudio(peer: Peer) {
  peer.stopMeter?.();
  peer.stopMeter = null;
  if (peer.audioEl) {
    peer.audioEl.srcObject = null;
    peer.audioEl.remove();
    peer.audioEl = null;
  }
}

function removeRemoteScreen(id: string, stream?: MediaStream) {
  setCollab((s) => {
    if (!s.remoteScreens[id] || (stream && s.remoteScreens[id] !== stream)) return {};
    const next = { ...s.remoteScreens };
    delete next[id];
    return { remoteScreens: next };
  });
}

/** Add/remove our outgoing tracks on the connection to `id` according to the current state. */
function syncPeer(id: string) {
  const state = getCollab();
  const remote = state.peerMedia[id];
  const micTrack = micStream?.getAudioTracks()[0] ?? null;
  const screenTrack = screenStream?.getVideoTracks()[0] ?? null;
  const wantMic = !!(state.inVoice && micTrack && remote?.inVoice);
  const wantScreen = !!screenTrack;
  let p = peers.get(id);
  if (!p && !wantMic && !wantScreen) return;
  p ??= ensurePeer(id);
  try {
    if (wantMic && !p.micSender) p.micSender = p.pc.addTrack(micTrack!, micStream!);
    else if (!wantMic && p.micSender) {
      p.pc.removeTrack(p.micSender);
      p.micSender = null;
    }
    if (wantScreen && !p.screenSender) p.screenSender = p.pc.addTrack(screenTrack!, screenStream!);
    else if (!wantScreen && p.screenSender) {
      p.pc.removeTrack(p.screenSender);
      p.screenSender = null;
    }
  } catch (err) {
    console.warn("[collab] track sync failed", err);
  }
}

const syncAllPeers = () => host?.peers().forEach(syncPeer);

// ---- public API used by the session ---------------------------------------------------------

export async function handleSignal(from: string, data: any) {
  if (!data || typeof data !== "object") return;
  const p = ensurePeer(from);
  const pc = p.pc;
  try {
    if (data.description && typeof data.description.type === "string") {
      const description = data.description as RTCSessionDescriptionInit;
      const collision = description.type === "offer" && (p.makingOffer || pc.signalingState !== "stable");
      p.ignoreOffer = !p.polite && collision;
      if (p.ignoreOffer) return;
      await pc.setRemoteDescription(description);
      if (description.type === "offer") {
        await pc.setLocalDescription();
        if (pc.localDescription) host?.sendSignal(from, { description: pc.localDescription.toJSON() });
      }
    } else if (data.candidate) {
      try {
        await pc.addIceCandidate(data.candidate as RTCIceCandidateInit);
      } catch (err) {
        if (!p.ignoreOffer) throw err;
      }
    }
  } catch (err) {
    console.warn("[collab] signaling error", err);
  }
}

/** A peer announced their media state (or joined/re-announced). */
export function onPeerMediaState(id: string, state: PeerMediaState) {
  const prev = getCollab().peerMedia[id];
  setCollab((s) => ({ peerMedia: { ...s.peerMedia, [id]: state } }));
  const p = peers.get(id);
  if (p && prev?.inVoice && !state.inVoice) {
    detachAudio(p);
    host?.setSpeaking(id, false);
  }
  if (prev?.sharing && !state.sharing) removeRemoteScreen(id);
  syncPeer(id);
}

export function closePeer(id: string) {
  const p = peers.get(id);
  if (p) {
    detachAudio(p);
    p.pc.onnegotiationneeded = p.pc.onicecandidate = p.pc.ontrack = p.pc.onconnectionstatechange = null;
    p.pc.close();
    peers.delete(id);
  }
  removeRemoteScreen(id);
  setCollab((s) => {
    if (!s.peerMedia[id] && !s.hiddenScreens[id]) return {};
    const peerMedia = { ...s.peerMedia };
    const hiddenScreens = { ...s.hiddenScreens };
    delete peerMedia[id];
    delete hiddenScreens[id];
    return { peerMedia, hiddenScreens };
  });
}

/** Close all peer connections (e.g. on reconnect, our socket id changes) but keep local media. */
export function closeAllPeers() {
  for (const id of [...peers.keys()]) closePeer(id);
  setCollab({ peerMedia: {}, remoteScreens: {}, hiddenScreens: {} });
}

function mediaErrorMessage(err: any, what: "microphone" | "screen") {
  const name = err?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return what === "microphone"
      ? "Microphone access was blocked. Allow it in your browser's site settings to join voice."
      : "Screen sharing was cancelled or blocked.";
  if (name === "NotFoundError" || name === "OverconstrainedError")
    return what === "microphone" ? "No microphone was found on this device." : "No screen is available to share.";
  if (name === "NotReadableError") return `Your ${what} is being used by another application.`;
  return what === "microphone" ? "Couldn't start the microphone." : "Couldn't start screen sharing.";
}

export async function joinVoice() {
  const state = getCollab();
  if (!state.active || state.inVoice) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    showToast("Voice isn't supported in this browser.", "error");
    return;
  }
  const inVoice = Object.values(state.peerMedia).filter((m) => m.inVoice).length;
  if (inVoice + 1 > MAX_VOICE_PEERS) {
    showToast(`The voice hangout is full (max ${MAX_VOICE_PEERS} people).`, "error");
    return;
  }
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (err) {
    showToast(mediaErrorMessage(err, "microphone"), "error");
    return;
  }
  if (!getCollab().active) {
    micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
    return;
  }
  const track = micStream.getAudioTracks()[0];
  track?.addEventListener("ended", () => leaveVoice());
  setCollab({ inVoice: true, muted: false });
  stopSelfMeter = meter(micStream, (speaking) => setCollab({ selfSpeaking: speaking }));
  syncAllPeers();
  host?.broadcastMediaState();
}

export function leaveVoice() {
  if (!micStream && !getCollab().inVoice) return;
  stopSelfMeter?.();
  stopSelfMeter = null;
  micStream?.getTracks().forEach((t) => t.stop());
  micStream = null;
  setCollab({ inVoice: false, muted: false, selfSpeaking: false });
  syncAllPeers();
  // stop listening to everyone
  for (const p of peers.values()) {
    detachAudio(p);
    host?.setSpeaking(p.id, false);
  }
  host?.broadcastMediaState();
}

export const toggleVoice = () => (getCollab().inVoice ? leaveVoice() : void joinVoice());

export function toggleMute() {
  const s = getCollab();
  if (!s.inVoice || !micStream) return;
  const muted = !s.muted;
  micStream.getAudioTracks().forEach((t) => (t.enabled = !muted));
  setCollab({ muted });
  host?.broadcastMediaState();
}

export async function startScreenShare() {
  const s = getCollab();
  if (!s.active || s.sharingScreen) return;
  if (!navigator.mediaDevices?.getDisplayMedia) {
    showToast("Screen sharing isn't supported on this device.", "error");
    return;
  }
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 } }, audio: false });
  } catch (err: any) {
    screenStream = null;
    showToast(mediaErrorMessage(err, "screen"), err?.name === "NotAllowedError" ? "info" : "error");
    return;
  }
  if (!getCollab().active) {
    screenStream.getTracks().forEach((t) => t.stop());
    screenStream = null;
    return;
  }
  const track = screenStream.getVideoTracks()[0];
  if (track) {
    track.contentHint = "detail";
    track.addEventListener("ended", () => stopScreenShare());
  }
  setCollab({ sharingScreen: true });
  syncAllPeers();
  host?.broadcastMediaState();
}

export function stopScreenShare() {
  if (!screenStream && !getCollab().sharingScreen) return;
  screenStream?.getTracks().forEach((t) => t.stop());
  screenStream = null;
  setCollab({ sharingScreen: false });
  syncAllPeers();
  host?.broadcastMediaState();
}

export const toggleScreenShare = () => (getCollab().sharingScreen ? stopScreenShare() : void startScreenShare());

/** Full teardown when leaving the room. */
export function shutdownRtc() {
  stopSelfMeter?.();
  stopSelfMeter = null;
  micStream?.getTracks().forEach((t) => t.stop());
  screenStream?.getTracks().forEach((t) => t.stop());
  micStream = screenStream = null;
  closeAllPeers();
  audioRoot?.remove();
  audioRoot = null;
  if (audioCtx) {
    void audioCtx.close().catch(() => {});
    audioCtx = null;
  }
  setCollab({ inVoice: false, muted: false, sharingScreen: false, selfSpeaking: false });
}
