// WebSocket connection to the relay with reconnect/backoff and liveness checks (tab sleep, network loss).

export type PortalStatus = "connecting" | "connected" | "reconnecting" | "offline";

/** After this many failed attempts in a row the relay counts as unreachable ("Offline"). */
const MAX_SILENT_RETRIES = 8;

/**
 * Relay URL. In production the app is on Vercel (no WebSockets) and the relay runs elsewhere,
 * configured with VITE_WS_URL (e.g. wss://excalimade-relay.onrender.com/ws). Locally: same host.
 */
export const relayUrl = () =>
  (import.meta.env.VITE_WS_URL as string | undefined) || `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;

export interface ServerMessage {
  type: string;
  [key: string]: any;
}

const VOLATILE_BUFFER_LIMIT = 1024 * 1024;
const PING_INTERVAL = 20_000;
const PONG_TIMEOUT = 5_000;

export class Portal {
  private ws: WebSocket | null = null;
  private closed = false;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private pongTimer: ReturnType<typeof setTimeout> | undefined;

  private onMessage: (msg: ServerMessage) => void;
  private onStatus: (status: PortalStatus) => void;
  /** Called every time the socket opens (first connect and every reconnect). */
  private onOpen: () => void;

  constructor(
    onMessage: (msg: ServerMessage) => void,
    onStatus: (status: PortalStatus) => void,
    onOpen: () => void,
  ) {
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.onOpen = onOpen;
    window.addEventListener("online", this.handleOnline);
    window.addEventListener("offline", this.handleOffline);
    document.addEventListener("visibilitychange", this.handleVisibility);
    this.connect();
  }

  get isOpen() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private connect() {
    if (this.closed) return;
    clearTimeout(this.reconnectTimer);
    this.onStatus(this.currentFailureStatus());
    const url = relayUrl();
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.attempt = 0;
      this.onStatus("connected");
      this.startPing();
      this.onOpen();
    };
    ws.onmessage = (e) => {
      if (this.ws !== ws || typeof e.data !== "string") return;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.type === "pong") {
        clearTimeout(this.pongTimer);
        return;
      }
      this.onMessage(msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.stopPing();
      if (!this.closed) {
        this.scheduleReconnect();
        this.onStatus(this.currentFailureStatus());
      }
    };
    ws.onerror = () => ws.close();
  }

  /** "Offline" only when the browser is offline or the relay stayed unreachable through many retries. */
  private currentFailureStatus(): PortalStatus {
    if (!navigator.onLine || this.attempt >= MAX_SILENT_RETRIES) return "offline";
    return this.attempt === 0 ? "connecting" : "reconnecting";
  }

  private handleOffline = () => {
    if (!this.isOpen) this.onStatus("offline");
  };

  private scheduleReconnect() {
    if (this.closed) return;
    clearTimeout(this.reconnectTimer);
    const base = Math.min(30_000, 1000 * 2 ** this.attempt++);
    this.reconnectTimer = setTimeout(() => this.connect(), base * (0.7 + Math.random() * 0.6));
  }

  /** Drop the current socket and connect again immediately. */
  reconnectNow() {
    if (this.closed) return;
    const ws = this.ws;
    this.ws = null;
    this.stopPing();
    if (ws) {
      ws.onclose = ws.onmessage = ws.onerror = ws.onopen = null;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
    this.attempt = 0;
    this.connect();
  }

  private startPing() {
    this.stopPing();
    this.pingTimer = setInterval(() => this.checkAlive(), PING_INTERVAL);
  }
  private stopPing() {
    clearInterval(this.pingTimer);
    clearTimeout(this.pongTimer);
  }

  /** Sends an app-level ping; if no pong arrives soon the connection is considered dead. */
  checkAlive() {
    if (!this.isOpen) return;
    clearTimeout(this.pongTimer);
    this.pongTimer = setTimeout(() => this.reconnectNow(), PONG_TIMEOUT);
    this.ws!.send(JSON.stringify({ type: "ping", t: Date.now() }));
  }

  private handleOnline = () => {
    if (!this.isOpen) this.reconnectNow();
  };
  private handleVisibility = () => {
    if (document.visibilityState !== "visible") return;
    if (this.isOpen) this.checkAlive();
    else if (!this.closed) this.reconnectNow();
  };

  send(msg: object, volatile = false): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    if (volatile && ws.bufferedAmount > VOLATILE_BUFFER_LIMIT) return false;
    ws.send(JSON.stringify(msg));
    return true;
  }

  close() {
    this.closed = true;
    clearTimeout(this.reconnectTimer);
    this.stopPing();
    window.removeEventListener("online", this.handleOnline);
    window.removeEventListener("offline", this.handleOffline);
    document.removeEventListener("visibilitychange", this.handleVisibility);
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = ws.onmessage = ws.onerror = ws.onopen = null;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
  }
}
