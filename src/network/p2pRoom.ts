import { isCharacterId } from "../characters";
import type {
  BubbleMessage,
  PlayerRole,
  PlayerState,
  PresenceMessage,
  RoomSession,
  StateMessage,
  WelcomeMessage,
} from "../types";

const PEERJS_MODULE_URL = "https://esm.sh/peerjs@1.5.5?bundle";
const ROOM_PREFIX = "aori-beautiful-v3-";
const ROOM_TTL_MS = 30 * 60 * 1000;
const CONNECT_TIMEOUT_MS = 12_000;
const MAX_RECONNECT_MS = 8_000;
const MOTIONS = new Set([
  "idle",
  "run",
  "start-left",
  "start-right",
  "sandori",
  "racket-swing",
]);

interface DataConnectionLike {
  readonly peer: string;
  readonly open: boolean;
  on(event: "open", callback: () => void): void;
  on(event: "data", callback: (data: unknown) => void): void;
  on(event: "close", callback: () => void): void;
  on(event: "error", callback: (error: unknown) => void): void;
  send(data: unknown): void;
  close(): void;
}

interface PeerLike {
  readonly id: string;
  readonly destroyed: boolean;
  on(event: "open", callback: (id: string) => void): void;
  on(event: "connection", callback: (connection: DataConnectionLike) => void): void;
  on(event: "error", callback: (error: unknown) => void): void;
  on(event: "disconnected", callback: () => void): void;
  connect(id: string, options?: { reliable?: boolean; serialization?: string }): DataConnectionLike;
  reconnect(): void;
  destroy(): void;
}

interface PeerConstructor {
  new (id?: string, options?: { debug?: number }): PeerLike;
}

interface Bootstrap {
  peer: PeerLike;
  connection?: DataConnectionLike;
  session: RoomSession;
}

export interface P2PCallbacks {
  onStatus: (status: "connecting" | "connected" | "reconnecting" | "closed") => void;
  onWelcome: (message: WelcomeMessage) => void;
  onPresence: (message: PresenceMessage) => void;
  onState: (message: StateMessage) => void;
  onBubble: (message: BubbleMessage) => void;
  onExpired: () => void;
  onError: (message: string) => void;
}

type P2PWireMessage =
  | { kind: "hello"; role: PlayerRole; state?: PlayerState }
  | { kind: "state"; role: PlayerRole; state: PlayerState; sentAt: number }
  | { kind: "bubble"; role: PlayerRole; text: string; sequence: number; sentAt: number }
  | { kind: "ping"; sentAt: number }
  | { kind: "pong"; sentAt: number };

const pendingBootstraps = new Map<string, Bootstrap>();
let peerConstructorPromise: Promise<PeerConstructor> | null = null;

function randomToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomRoomCode(): string {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return String(10_000 + ((values[0] ?? 0) % 90_000));
}

function peerId(roomCode: string): string {
  return `${ROOM_PREFIX}${roomCode}`;
}

function errorType(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const candidate = error as { type?: unknown };
  return typeof candidate.type === "string" ? candidate.type : "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "unknown error");
}

async function loadPeerConstructor(): Promise<PeerConstructor> {
  peerConstructorPromise ??= import(/* @vite-ignore */ PEERJS_MODULE_URL).then((module) => {
    const candidate = (module as { Peer?: unknown }).Peer;
    if (typeof candidate !== "function") throw new Error("PeerJSを読み込めませんでした");
    return candidate as PeerConstructor;
  });
  return peerConstructorPromise;
}

function waitForPeerOpen(peer: PeerLike, timeoutMs = CONNECT_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("P2P接続サーバーへの接続がタイムアウトしました"));
    }, timeoutMs);
    peer.on("open", (id) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(id);
    });
    peer.on("error", (error) => {
      if (settled) return;
      const type = errorType(error);
      if (type !== "unavailable-id" && type !== "network" && type !== "server-error") return;
      settled = true;
      window.clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(errorMessage(error)));
    });
  });
}

function waitForConnectionOpen(
  peer: PeerLike,
  connection: DataConnectionLike,
  timeoutMs = CONNECT_TIMEOUT_MS,
): Promise<void> {
  if (connection.open) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = 0;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    timer = window.setTimeout(
      () => finish(new Error("相手の部屋へ接続できませんでした")),
      timeoutMs,
    );
    connection.on("open", () => finish());
    connection.on("close", () => finish(new Error("相手の部屋へ接続できませんでした")));
    connection.on("error", (error) => finish(new Error(errorMessage(error))));
    peer.on("error", (error) => {
      if (errorType(error) === "peer-unavailable") {
        finish(new Error("その部屋は存在しないか、終了しています"));
      }
    });
  });
}

function makeSession(roomCode: string, role: PlayerRole): RoomSession {
  return {
    roomCode,
    token: `p2p:${role}:${randomToken()}`,
    role,
    expiresAt: Date.now() + ROOM_TTL_MS,
  };
}

export function shouldUseP2PTransport(): boolean {
  const forced = new URLSearchParams(location.search).get("transport") === "p2p";
  if (forced) return true;
  const host = location.hostname.toLowerCase();
  return (
    host === "cdn.jsdelivr.net" ||
    host === "raw.githack.com" ||
    host.endsWith(".github.io") ||
    (host.endsWith(".pages.dev") && location.pathname.includes("static"))
  );
}

export function isP2PSession(session: RoomSession): boolean {
  return session.token.startsWith("p2p:");
}

export async function createP2PRoom(): Promise<RoomSession> {
  const Peer = await loadPeerConstructor();
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 18; attempt += 1) {
    const roomCode = randomRoomCode();
    const peer = new Peer(peerId(roomCode), { debug: 0 });
    try {
      await waitForPeerOpen(peer);
      const session = makeSession(roomCode, "host");
      pendingBootstraps.set(session.token, { peer, session });
      return session;
    } catch (error) {
      lastError = error;
      peer.destroy();
      if (errorType(error) !== "unavailable-id") break;
    }
  }
  throw new Error(
    `P2Pの部屋を作れませんでした${lastError ? `: ${errorMessage(lastError)}` : ""}`,
  );
}

export async function joinP2PRoom(roomCodeInput: string): Promise<RoomSession> {
  const roomCode = roomCodeInput.replace(/\D/g, "").slice(0, 5);
  if (!/^\d{5}$/.test(roomCode)) throw new Error("5桁の部屋番号を入力してください");
  const Peer = await loadPeerConstructor();
  const peer = new Peer(undefined, { debug: 0 });
  try {
    await waitForPeerOpen(peer);
    const connection = peer.connect(peerId(roomCode), {
      reliable: true,
      serialization: "json",
    });
    await waitForConnectionOpen(peer, connection);
    const session = makeSession(roomCode, "guest");
    pendingBootstraps.set(session.token, { peer, connection, session });
    return session;
  } catch (error) {
    peer.destroy();
    throw error;
  }
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function sanitizeState(value: unknown): PlayerState | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const motion = candidate.motion;
  if (typeof motion !== "string" || !MOTIONS.has(motion)) return null;
  return {
    x: Math.min(4.5, Math.max(-4.5, finiteNumber(candidate.x))),
    z: Math.min(5, Math.max(-5, finiteNumber(candidate.z))),
    yaw: Math.min(Math.PI, Math.max(-Math.PI, finiteNumber(candidate.yaw))),
    speed: Math.min(7, Math.max(0, finiteNumber(candidate.speed))),
    motion: motion as PlayerState["motion"],
    motionSequence: Math.max(0, Math.trunc(finiteNumber(candidate.motionSequence))),
    clientTime: Math.max(0, finiteNumber(candidate.clientTime)),
    ...(isCharacterId(candidate.characterId) ? { characterId: candidate.characterId } : {}),
  };
}

function sanitizeBubble(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 40);
  return clean || null;
}

function parseWireMessage(value: unknown): P2PWireMessage | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind === "hello" && (candidate.role === "host" || candidate.role === "guest")) {
    const state = sanitizeState(candidate.state);
    return {
      kind: "hello",
      role: candidate.role,
      ...(state ? { state } : {}),
    };
  }
  if (candidate.kind === "state" && (candidate.role === "host" || candidate.role === "guest")) {
    const state = sanitizeState(candidate.state);
    if (!state) return null;
    return {
      kind: "state",
      role: candidate.role,
      state,
      sentAt: Math.max(0, finiteNumber(candidate.sentAt, Date.now())),
    };
  }
  if (candidate.kind === "bubble" && (candidate.role === "host" || candidate.role === "guest")) {
    const text = sanitizeBubble(candidate.text);
    if (!text) return null;
    return {
      kind: "bubble",
      role: candidate.role,
      text,
      sequence: Math.max(0, Math.trunc(finiteNumber(candidate.sequence))),
      sentAt: Math.max(0, finiteNumber(candidate.sentAt, Date.now())),
    };
  }
  if (candidate.kind === "ping" || candidate.kind === "pong") {
    return { kind: candidate.kind, sentAt: Math.max(0, finiteNumber(candidate.sentAt, Date.now())) };
  }
  return null;
}

export class P2PRoomClient {
  private readonly session: RoomSession;
  private readonly callbacks: P2PCallbacks;
  private readonly peer: PeerLike;
  private connection: DataConnectionLike | null;
  private latestState: PlayerState | null = null;
  private stopped = false;
  private reconnectAttempt = 0;
  private reconnectTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private expiryTimer: number | null = null;

  constructor(session: RoomSession, callbacks: P2PCallbacks) {
    const bootstrap = pendingBootstraps.get(session.token);
    if (!bootstrap) throw new Error("P2P入室情報が見つかりません。入り直してください");
    pendingBootstraps.delete(session.token);
    this.session = session;
    this.callbacks = callbacks;
    this.peer = bootstrap.peer;
    this.connection = bootstrap.connection ?? null;
  }

  start(): void {
    this.stopped = false;
    this.callbacks.onStatus("connecting");
    const presence = {
      host: true,
      guest: this.session.role === "guest" && Boolean(this.connection?.open),
    };
    this.callbacks.onWelcome({
      type: "welcome",
      role: this.session.role,
      roomCode: this.session.roomCode,
      expiresAt: this.session.expiresAt,
      presence,
    });

    if (this.session.role === "host") {
      this.callbacks.onStatus("connected");
      this.peer.on("connection", (connection) => this.acceptHostConnection(connection));
    } else if (this.connection) {
      this.attachConnection(this.connection);
    } else {
      this.scheduleReconnect();
    }

    this.peer.on("disconnected", () => {
      if (this.stopped) return;
      try {
        this.peer.reconnect();
      } catch {
        this.scheduleReconnect();
      }
    });
    this.peer.on("error", (error) => {
      if (this.stopped || errorType(error) === "peer-unavailable") return;
      this.callbacks.onError(`P2P通信エラー: ${errorMessage(error)}`);
    });
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    window.addEventListener("online", this.onOnline);
    this.expiryTimer = window.setTimeout(
      () => this.callbacks.onExpired(),
      Math.max(0, this.session.expiresAt - Date.now()),
    );
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    window.removeEventListener("online", this.onOnline);
    this.clearReconnect();
    this.clearHeartbeat();
    if (this.expiryTimer !== null) window.clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    try {
      this.connection?.close();
    } catch {
      // Already closed.
    }
    this.connection = null;
    this.peer.destroy();
    this.callbacks.onStatus("closed");
  }

  sendState(state: PlayerState): void {
    this.latestState = sanitizeState(state);
    if (!this.latestState) return;
    this.send({
      kind: "state",
      role: this.session.role,
      state: this.latestState,
      sentAt: Date.now(),
    });
  }

  sendBubble(text: string, sequence: number): void {
    const clean = sanitizeBubble(text);
    if (!clean) return;
    this.send({
      kind: "bubble",
      role: this.session.role,
      text: clean,
      sequence: Math.max(0, Math.trunc(sequence)),
      sentAt: Date.now(),
    });
  }

  private acceptHostConnection(connection: DataConnectionLike): void {
    if (this.stopped) {
      connection.close();
      return;
    }
    if (this.connection?.open) {
      connection.close();
      return;
    }
    this.connection = connection;
    this.attachConnection(connection);
  }

  private attachConnection(connection: DataConnectionLike): void {
    const onOpen = (): void => {
      if (this.stopped || this.connection !== connection) return;
      this.reconnectAttempt = 0;
      this.callbacks.onStatus("connected");
      this.callbacks.onPresence({ type: "presence", presence: { host: true, guest: true } });
      this.send({
        kind: "hello",
        role: this.session.role,
        ...(this.latestState ? { state: this.latestState } : {}),
      });
      this.startHeartbeat();
    };
    connection.on("open", onOpen);
    connection.on("data", (data) => this.handleData(data));
    connection.on("close", () => {
      if (this.connection === connection) this.connection = null;
      this.clearHeartbeat();
      if (this.stopped) return;
      if (this.session.role === "host") {
        this.callbacks.onPresence({ type: "presence", presence: { host: true, guest: false } });
        this.callbacks.onStatus("connected");
      } else {
        this.callbacks.onPresence({ type: "presence", presence: { host: false, guest: true } });
        this.scheduleReconnect();
      }
    });
    connection.on("error", (error) => {
      if (!this.stopped) this.callbacks.onError(`P2Pデータ通信エラー: ${errorMessage(error)}`);
    });
    if (connection.open) queueMicrotask(onOpen);
  }

  private handleData(data: unknown): void {
    const message = parseWireMessage(data);
    if (!message) return;
    const now = Date.now();
    if (message.kind === "hello") {
      this.callbacks.onPresence({ type: "presence", presence: { host: true, guest: true } });
      if (message.state) {
        this.callbacks.onState({
          type: "state",
          role: message.role,
          state: message.state,
          serverTime: now,
        });
      }
      return;
    }
    if (message.kind === "state") {
      this.callbacks.onState({
        type: "state",
        role: message.role,
        state: message.state,
        serverTime: now,
      });
      return;
    }
    if (message.kind === "bubble") {
      this.callbacks.onBubble({
        type: "bubble",
        role: message.role,
        text: message.text,
        sequence: message.sequence,
        serverTime: now,
      });
      return;
    }
    if (message.kind === "ping") this.send({ kind: "pong", sentAt: now });
  }

  private send(message: P2PWireMessage): void {
    if (!this.connection?.open) return;
    try {
      this.connection.send(message);
    } catch {
      // The close event schedules recovery.
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.session.role !== "guest" || this.reconnectTimer !== null) return;
    this.callbacks.onStatus("reconnecting");
    const delay = Math.min(MAX_RECONNECT_MS, 450 * 2 ** this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (this.stopped) return;
      const connection = this.peer.connect(peerId(this.session.roomCode), {
        reliable: true,
        serialization: "json",
      });
      this.connection = connection;
      this.attachConnection(connection);
    }, delay + Math.random() * 250);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private startHeartbeat(): void {
    this.clearHeartbeat();
    this.heartbeatTimer = window.setInterval(
      () => this.send({ kind: "ping", sentAt: Date.now() }),
      15_000,
    );
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer !== null) window.clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState !== "visible" || this.stopped) return;
    if (this.session.role === "guest" && !this.connection?.open) this.scheduleReconnect();
  };

  private readonly onOnline = (): void => {
    if (!this.stopped && this.session.role === "guest" && !this.connection?.open) {
      this.scheduleReconnect();
    }
  };
}
