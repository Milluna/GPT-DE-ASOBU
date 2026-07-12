import { DurableObject } from "cloudflare:workers";

interface Env {
  ROOMS: DurableObjectNamespace;
  ASSETS: Fetcher;
}

type PlayerRole = "host" | "guest";
type CharacterId = "lumi" | "mio" | "sena";
type MotionName = "idle" | "run" | "start-left" | "start-right" | "sandori" | "racket-swing";

interface PlayerState {
  x: number;
  z: number;
  yaw: number;
  speed: number;
  motion: MotionName;
  motionSequence: number;
  clientTime: number;
  characterId?: CharacterId;
}

interface RoomRecord {
  roomCode: string;
  hostToken: string;
  guestToken: string | null;
  createdAt: number;
  expiresAt: number;
  guestDisconnectedAt: number | null;
}

interface SocketAttachment {
  role: PlayerRole;
  token: string;
  lastStateAt: number;
  lastBubbleAt: number;
  state?: PlayerState;
}

const ROOM_TTL_MS = 30 * 60 * 1000;
const GUEST_RECONNECT_GRACE_MS = 2 * 60 * 1000;
const MAX_MESSAGE_BYTES = 4_096;
const CHARACTER_IDS = new Set<CharacterId>(["lumi", "mio", "sena"]);
const MOTIONS = new Set<MotionName>([
  "idle",
  "run",
  "start-left",
  "start-right",
  "sandori",
  "racket-swing",
]);

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function randomToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomRoomCode(): string {
  const random = new Uint32Array(1);
  crypto.getRandomValues(random);
  return String(10_000 + ((random[0] ?? 0) % 90_000));
}

function isFiveDigitCode(value: string): boolean {
  return /^\d{5}$/.test(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function sanitizePlayerState(value: unknown): PlayerState | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const motion = candidate.motion;
  if (typeof motion !== "string" || !MOTIONS.has(motion as MotionName)) return null;
  return {
    x: clamp(finiteNumber(candidate.x), -4.5, 4.5),
    z: clamp(finiteNumber(candidate.z), -5, 5),
    yaw: clamp(finiteNumber(candidate.yaw), -Math.PI, Math.PI),
    speed: clamp(finiteNumber(candidate.speed), 0, 7),
    motion: motion as MotionName,
    motionSequence: clamp(Math.trunc(finiteNumber(candidate.motionSequence)), 0, 2_147_483_647),
    clientTime: clamp(finiteNumber(candidate.clientTime), 0, Number.MAX_SAFE_INTEGER),
    ...(typeof candidate.characterId === "string" &&
    CHARACTER_IDS.has(candidate.characterId as CharacterId)
      ? { characterId: candidate.characterId as CharacterId }
      : {}),
  };
}

function sanitizeBubble(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 40);
  return clean || null;
}

function readAttachment(socket: WebSocket): SocketAttachment | null {
  const value: unknown = socket.deserializeAttachment();
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<SocketAttachment>;
  if ((candidate.role !== "host" && candidate.role !== "guest") || typeof candidate.token !== "string") {
    return null;
  }
  return {
    role: candidate.role,
    token: candidate.token,
    lastStateAt: finiteNumber(candidate.lastStateAt),
    lastBubbleAt: finiteNumber(candidate.lastBubbleAt),
    ...(candidate.state ? { state: candidate.state } : {}),
  };
}

function safeSend(socket: WebSocket, value: unknown): void {
  try {
    socket.send(JSON.stringify(value));
  } catch {
    // The close handler will clean up the connection.
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/api/rooms") {
      for (let attempt = 0; attempt < 24; attempt += 1) {
        const roomCode = randomRoomCode();
        const response = await env.ROOMS.getByName(roomCode).fetch("https://room.internal/reserve", {
          method: "POST",
          headers: { "x-room-code": roomCode },
        });
        if (response.status === 201) return response;
        if (response.status !== 409) return response;
      }
      return json({ message: "空いている部屋番号を確保できませんでした。もう一度お試しください" }, 503);
    }

    const joinMatch = url.pathname.match(/^\/api\/rooms\/(\d{5})\/join$/);
    if (request.method === "POST" && joinMatch) {
      const roomCode = joinMatch[1];
      if (!roomCode) return json({ message: "部屋番号が不正です" }, 400);
      const body = await request.text();
      return env.ROOMS.getByName(roomCode).fetch("https://room.internal/join", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-room-code": roomCode,
        },
        body,
      });
    }

    const socketMatch = url.pathname.match(/^\/ws\/(\d{5})$/);
    if (request.method === "GET" && socketMatch) {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return new Response("WebSocket upgrade required", { status: 426 });
      }
      const roomCode = socketMatch[1];
      if (!roomCode) return new Response("Invalid room code", { status: 400 });
      const internalUrl = new URL("https://room.internal/websocket");
      internalUrl.searchParams.set("token", url.searchParams.get("token") ?? "");
      return env.ROOMS.getByName(roomCode).fetch(
        new Request(internalUrl, {
          method: "GET",
          headers: request.headers,
        }),
      );
    }

    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/ws/")) {
      return json({ message: "見つかりません" }, 404);
    }

    return env.ASSETS.fetch(request);
  },
};

export class TauntRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/reserve" && request.method === "POST") return this.reserve(request);
    if (url.pathname === "/join" && request.method === "POST") return this.join(request);
    if (url.pathname === "/websocket" && request.method === "GET") return this.openSocket(request);
    return json({ message: "見つかりません" }, 404);
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string" || message.length > MAX_MESSAGE_BYTES) {
      socket.close(1009, "message too large");
      return;
    }

    const attachment = readAttachment(socket);
    if (!attachment) {
      socket.close(4003, "invalid session");
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(message);
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== "object" || !("type" in parsed)) return;
    const candidate = parsed as Record<string, unknown>;
    const now = Date.now();

    if (candidate.type === "state") {
      if (now - attachment.lastStateAt < 25) return;
      const state = sanitizePlayerState(candidate.state);
      if (!state) return;
      attachment.lastStateAt = now;
      attachment.state = state;
      socket.serializeAttachment(attachment);
      this.broadcastExcept(socket, {
        type: "state",
        role: attachment.role,
        state,
        serverTime: now,
      });
      return;
    }

    if (candidate.type === "bubble") {
      if (now - attachment.lastBubbleAt < 100) return;
      const text = sanitizeBubble(candidate.text);
      if (!text) return;
      attachment.lastBubbleAt = now;
      socket.serializeAttachment(attachment);
      this.broadcastExcept(socket, {
        type: "bubble",
        role: attachment.role,
        text,
        sequence: clamp(Math.trunc(finiteNumber(candidate.sequence)), 0, 2_147_483_647),
        serverTime: now,
      });
      return;
    }

    if (candidate.type === "ping") {
      safeSend(socket, { type: "pong", serverTime: now });
    }
  }

  async webSocketClose(socket: WebSocket, code: number, reason: string): Promise<void> {
    const attachment = readAttachment(socket);
    socket.close(code, reason);
    if (attachment?.role === "guest") {
      const room = await this.getActiveRoom();
      if (room) {
        room.guestDisconnectedAt = Date.now();
        await this.ctx.storage.put("room", room);
      }
    }
    this.broadcastPresence();
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    const attachment = readAttachment(socket);
    try {
      socket.close(1011, "websocket error");
    } catch {
      // Already closed.
    }
    if (attachment?.role === "guest") {
      const room = await this.getActiveRoom();
      if (room) {
        room.guestDisconnectedAt = Date.now();
        await this.ctx.storage.put("room", room);
      }
    }
    this.broadcastPresence();
  }

  async alarm(): Promise<void> {
    await this.expireRoom();
  }

  private async reserve(request: Request): Promise<Response> {
    const roomCode = request.headers.get("x-room-code") ?? "";
    if (!isFiveDigitCode(roomCode)) return json({ message: "部屋番号が不正です" }, 400);

    const existing = await this.ctx.storage.get<RoomRecord>("room");
    const now = Date.now();
    if (existing && existing.expiresAt > now) return json({ message: "使用中です" }, 409);
    if (existing) await this.expireRoom();

    const room: RoomRecord = {
      roomCode,
      hostToken: randomToken(),
      guestToken: null,
      createdAt: now,
      expiresAt: now + ROOM_TTL_MS,
      guestDisconnectedAt: null,
    };
    await this.ctx.storage.put("room", room);
    await this.ctx.storage.setAlarm(room.expiresAt);
    return json(
      {
        roomCode,
        token: room.hostToken,
        role: "host",
        expiresAt: room.expiresAt,
      },
      201,
    );
  }

  private async join(request: Request): Promise<Response> {
    const room = await this.getActiveRoom();
    if (!room) return json({ message: "その部屋は存在しないか、期限切れです" }, 404);

    let resumeToken: string | null = null;
    try {
      const body = (await request.json()) as { resumeToken?: unknown };
      resumeToken = typeof body.resumeToken === "string" ? body.resumeToken : null;
    } catch {
      // Empty or invalid body is treated as a fresh join.
    }

    const now = Date.now();
    const guestConnected = this.ctx.getWebSockets("guest").some(
      (socket) => socket.readyState === WebSocket.OPEN,
    );
    const reconnectGraceExpired =
      room.guestDisconnectedAt !== null && now - room.guestDisconnectedAt > GUEST_RECONNECT_GRACE_MS;

    if (room.guestToken && resumeToken === room.guestToken) {
      // Resume the same guest slot.
    } else if (!room.guestToken || (!guestConnected && reconnectGraceExpired)) {
      room.guestToken = randomToken();
      room.guestDisconnectedAt = null;
      await this.ctx.storage.put("room", room);
    } else {
      return json({ message: "この部屋にはすでに2人います" }, 409);
    }

    const guestToken = room.guestToken;
    if (!guestToken) return json({ message: "入室情報を作成できませんでした" }, 500);
    return json({
      roomCode: room.roomCode,
      token: guestToken,
      role: "guest",
      expiresAt: room.expiresAt,
    });
  }

  private async openSocket(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket upgrade required", { status: 426 });
    }

    const room = await this.getActiveRoom();
    if (!room) return new Response("Room expired", { status: 404 });
    const token = new URL(request.url).searchParams.get("token") ?? "";
    let role: PlayerRole | null = null;
    if (token === room.hostToken) role = "host";
    if (room.guestToken && token === room.guestToken) role = "guest";
    if (!role) return new Response("Invalid session", { status: 403 });

    for (const existing of this.ctx.getWebSockets(role)) {
      try {
        existing.close(4001, "replaced by a newer connection");
      } catch {
        // Ignore stale sockets.
      }
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server, [role]);
    const attachment: SocketAttachment = {
      role,
      token,
      lastStateAt: 0,
      lastBubbleAt: 0,
    };
    server.serializeAttachment(attachment);

    if (role === "guest" && room.guestDisconnectedAt !== null) {
      room.guestDisconnectedAt = null;
      await this.ctx.storage.put("room", room);
    }

    const peerRole: PlayerRole = role === "host" ? "guest" : "host";
    const peerSocket = this.ctx
      .getWebSockets(peerRole)
      .find((socket) => socket.readyState === WebSocket.OPEN);
    const peerState = peerSocket ? readAttachment(peerSocket)?.state : undefined;
    const welcome: Record<string, unknown> = {
      type: "welcome",
      role,
      roomCode: room.roomCode,
      expiresAt: room.expiresAt,
      presence: this.getPresence(),
    };
    if (peerState) welcome.peerState = peerState;
    safeSend(server, welcome);
    this.broadcastPresence();

    return new Response(null, { status: 101, webSocket: client });
  }

  private async getActiveRoom(): Promise<RoomRecord | null> {
    const room = await this.ctx.storage.get<RoomRecord>("room");
    if (!room) return null;
    if (room.expiresAt <= Date.now()) {
      await this.expireRoom();
      return null;
    }
    return room;
  }

  private getPresence(): { host: boolean; guest: boolean } {
    return {
      host: this.ctx.getWebSockets("host").some((socket) => socket.readyState === WebSocket.OPEN),
      guest: this.ctx.getWebSockets("guest").some((socket) => socket.readyState === WebSocket.OPEN),
    };
  }

  private broadcastPresence(): void {
    this.broadcastExcept(null, { type: "presence", presence: this.getPresence() });
  }

  private broadcastExcept(excluded: WebSocket | null, value: unknown): void {
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === excluded || socket.readyState !== WebSocket.OPEN) continue;
      safeSend(socket, value);
    }
  }

  private async expireRoom(): Promise<void> {
    for (const socket of this.ctx.getWebSockets()) {
      safeSend(socket, { type: "expired" });
      try {
        socket.close(4000, "room expired");
      } catch {
        // Ignore close races.
      }
    }
    await this.ctx.storage.deleteAll();
  }
}
