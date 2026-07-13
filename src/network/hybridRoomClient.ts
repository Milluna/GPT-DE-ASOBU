import type {
  BubbleMessage,
  ClientMessage,
  PlayerState,
  PresenceMessage,
  RoomSession,
  ServerMessage,
  StateMessage,
  WelcomeMessage,
} from "../types";
import {
  createP2PRoom,
  isP2PSession,
  joinP2PRoom,
  P2PRoomClient,
  shouldUseP2PTransport,
  type P2PCallbacks,
} from "./p2pRoom";

export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "closed";

interface RoomClientCallbacks extends P2PCallbacks {
  onStatus: (status: ConnectionStatus) => void;
  onWelcome: (message: WelcomeMessage) => void;
  onPresence: (message: PresenceMessage) => void;
  onState: (message: StateMessage) => void;
  onBubble: (message: BubbleMessage) => void;
  onExpired: () => void;
  onError: (message: string) => void;
}

interface CreateRoomResponse {
  roomCode: string;
  token: string;
  role: "host";
  expiresAt: number;
}

interface JoinRoomResponse {
  roomCode: string;
  token: string;
  role: "guest";
  expiresAt: number;
}

const REQUEST_TIMEOUT_MS = 10_000;
const HEARTBEAT_MS = 15_000;
const MAX_RECONNECT_MS = 8_000;

function sessionKey(roomCode: string, role: "host" | "guest"): string {
  return `aori-room.session.${roomCode}.${role}`;
}

async function fetchJson<T>(url: string, init: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        ...init.headers,
      },
    });
    const data: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message =
        data && typeof data === "object" && "message" in data && typeof data.message === "string"
          ? data.message
          : `通信に失敗しました (${response.status})`;
      throw new Error(message);
    }
    return data as T;
  } finally {
    window.clearTimeout(timeout);
  }
}

function isServerMessage(value: unknown): value is ServerMessage {
  return Boolean(value && typeof value === "object" && "type" in value && typeof value.type === "string");
}

export async function createRoom(): Promise<RoomSession> {
  if (shouldUseP2PTransport()) return createP2PRoom();
  const data = await fetchJson<CreateRoomResponse>("/api/rooms", {
    method: "POST",
    body: "{}",
  });
  localStorage.setItem(sessionKey(data.roomCode, data.role), data.token);
  return data;
}

export async function joinRoom(roomCodeInput: string): Promise<RoomSession> {
  const roomCode = roomCodeInput.replace(/\D/g, "").slice(0, 5);
  if (!/^\d{5}$/.test(roomCode)) throw new Error("5桁の部屋番号を入力してください");
  if (shouldUseP2PTransport()) return joinP2PRoom(roomCode);
  const storedToken = localStorage.getItem(sessionKey(roomCode, "guest"));
  const data = await fetchJson<JoinRoomResponse>(`/api/rooms/${roomCode}/join`, {
    method: "POST",
    body: JSON.stringify({ resumeToken: storedToken }),
  });
  localStorage.setItem(sessionKey(data.roomCode, data.role), data.token);
  return data;
}

export class RoomClient {
  private readonly session: RoomSession;
  private readonly callbacks: RoomClientCallbacks;
  private readonly p2pClient: P2PRoomClient | null;
  private socket: WebSocket | null = null;
  private stopped = false;
  private reconnectAttempt = 0;
  private reconnectTimer: number | null = null;
  private heartbeatTimer: number | null = null;

  constructor(session: RoomSession, callbacks: RoomClientCallbacks) {
    this.session = session;
    this.callbacks = callbacks;
    this.p2pClient = isP2PSession(session) ? new P2PRoomClient(session, callbacks) : null;
  }

  start(): void {
    if (this.p2pClient) {
      this.p2pClient.start();
      return;
    }
    this.stopped = false;
    this.callbacks.onStatus("connecting");
    this.connect();
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    window.addEventListener("pageshow", this.onPageShow);
    window.addEventListener("online", this.onOnline);
  }

  stop(): void {
    if (this.p2pClient) {
      this.p2pClient.stop();
      return;
    }
    this.stopped = true;
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    window.removeEventListener("pageshow", this.onPageShow);
    window.removeEventListener("online", this.onOnline);
    this.clearReconnect();
    this.clearHeartbeat();
    this.socket?.close(1000, "leaving room");
    this.socket = null;
    this.callbacks.onStatus("closed");
  }

  sendState(state: PlayerState): void {
    if (this.p2pClient) {
      this.p2pClient.sendState(state);
      return;
    }
    this.send({ type: "state", state });
  }

  sendBubble(text: string, sequence: number): void {
    if (this.p2pClient) {
      this.p2pClient.sendBubble(text, sequence);
      return;
    }
    this.send({ type: "bubble", text, sequence });
  }

  private connect(): void {
    if (this.stopped) return;
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.CONNECTING || this.socket.readyState === WebSocket.OPEN)
    ) return;

    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const url = new URL(`${protocol}//${location.host}/ws/${this.session.roomCode}`);
    url.searchParams.set("token", this.session.token);
    const socket = new WebSocket(url);
    this.socket = socket;

    socket.addEventListener("open", () => {
      if (this.socket !== socket) return;
      this.reconnectAttempt = 0;
      this.callbacks.onStatus("connected");
      this.startHeartbeat();
    });

    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string" || event.data.length > 16_384) return;
      try {
        const parsed: unknown = JSON.parse(event.data);
        if (!isServerMessage(parsed)) return;
        this.handleMessage(parsed);
      } catch {
        this.callbacks.onError("サーバーから読めないデータを受信しました");
      }
    });

    socket.addEventListener("close", (event) => {
      if (this.socket === socket) this.socket = null;
      this.clearHeartbeat();
      if (this.stopped || event.code === 1000) return;
      if (event.code === 4000) {
        this.callbacks.onExpired();
        return;
      }
      if (event.code === 4003) {
        this.callbacks.onError("入室情報が無効になりました。部屋に入り直してください");
        this.callbacks.onStatus("closed");
        return;
      }
      this.scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      if (this.socket === socket && socket.readyState === WebSocket.OPEN) {
        this.callbacks.onError("リアルタイム通信でエラーが発生しました");
      }
    });
  }

  private handleMessage(message: ServerMessage): void {
    switch (message.type) {
      case "welcome":
        this.callbacks.onWelcome(message);
        break;
      case "presence":
        this.callbacks.onPresence(message);
        break;
      case "state":
        this.callbacks.onState(message);
        break;
      case "bubble":
        this.callbacks.onBubble(message);
        break;
      case "expired":
        this.callbacks.onExpired();
        break;
      case "error":
        this.callbacks.onError(message.message);
        break;
      case "pong":
        break;
    }
  }

  private send(message: ClientMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(message));
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer !== null) return;
    this.callbacks.onStatus("reconnecting");
    const delay = Math.min(MAX_RECONNECT_MS, 400 * 2 ** this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay + Math.random() * 250);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private startHeartbeat(): void {
    this.clearHeartbeat();
    this.heartbeatTimer = window.setInterval(() => {
      this.send({ type: "ping", clientTime: performance.now() });
    }, HEARTBEAT_MS);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer !== null) window.clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState !== "visible" || this.stopped) return;
    if (!this.socket || this.socket.readyState >= WebSocket.CLOSING) this.scheduleReconnect();
  };

  private readonly onPageShow = (): void => {
    if (!this.stopped && (!this.socket || this.socket.readyState >= WebSocket.CLOSING)) {
      this.scheduleReconnect();
    }
  };

  private readonly onOnline = (): void => {
    if (!this.stopped) this.scheduleReconnect();
  };
}
