import assert from "node:assert/strict";

const DEFAULT_BASE_URL = "http://127.0.0.1:8787";
const REQUEST_TIMEOUT_MS = numberFromEnv("REQUEST_TIMEOUT_MS", 10_000);
const SOCKET_TIMEOUT_MS = numberFromEnv("SOCKET_TIMEOUT_MS", 8_000);
const WAIT_FOR_RELEASE_MS = numberFromEnv("WAIT_FOR_RELEASE_MS", 0);
const RELEASE_POLL_MS = numberFromEnv("RELEASE_POLL_MS", 5_000);
const EXPECTED_SHA = (process.env.EXPECTED_SHA ?? "").trim().toLowerCase();
const baseUrl = normalizeBaseUrl(process.env.BASE_URL ?? DEFAULT_BASE_URL);

let hostSocket;
let guestSocket;
let resumedGuestSocket;

function numberFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function normalizeBaseUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`BASE_URL must use http or https: ${value}`);
  }
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
}

function httpUrl(pathname) {
  return new URL(pathname.replace(/^\//, ""), baseUrl);
}

function socketUrl(session) {
  const url = httpUrl(`ws/${session.roomCode}`);
  url.protocol = baseUrl.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("token", session.token);
  return url;
}

function withTimeout(promise, timeoutMs, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function fetchWithTimeout(pathname, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(httpUrl(pathname), {
      ...init,
      signal: controller.signal,
      headers: {
        "cache-control": "no-cache",
        ...init.headers,
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(pathname, init, expectedStatus) {
  const response = await fetchWithTimeout(pathname, init);
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${pathname} returned non-JSON (${response.status}): ${text.slice(0, 160)}`);
  }
  assert.equal(
    response.status,
    expectedStatus,
    `${pathname} status ${response.status}; response=${JSON.stringify(data)}`,
  );
  return data;
}

function shaMatches(actual, expected) {
  if (!actual || !expected) return false;
  const normalizedActual = String(actual).trim().toLowerCase();
  return normalizedActual.startsWith(expected) || expected.startsWith(normalizedActual);
}

async function fetchRelease() {
  const response = await fetchWithTimeout(`release.json?smoke=${Date.now()}`);
  if (response.status !== 200) return null;
  return response.json().catch(() => null);
}

async function waitForExpectedRelease() {
  if (!EXPECTED_SHA) return null;
  const deadline = Date.now() + WAIT_FOR_RELEASE_MS;
  let lastRelease = null;
  let lastError = null;

  do {
    try {
      lastRelease = await fetchRelease();
      if (lastRelease && shaMatches(lastRelease.gitSha, EXPECTED_SHA)) return lastRelease;
      lastError = new Error(
        `release.json gitSha=${JSON.stringify(lastRelease?.gitSha ?? null)}; expected ${EXPECTED_SHA}`,
      );
    } catch (error) {
      lastError = error;
    }

    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, RELEASE_POLL_MS));
  } while (true);

  throw lastError ?? new Error(`release ${EXPECTED_SHA} was not observed`);
}

class SocketProbe {
  static async connect(session, label) {
    const socket = new WebSocket(socketUrl(session));
    const probe = new SocketProbe(socket, label);
    await probe.opened;
    return probe;
  }

  constructor(socket, label) {
    this.socket = socket;
    this.label = label;
    this.queue = [];
    this.waiters = new Set();
    this.closed = false;

    this.opened = withTimeout(
      new Promise((resolve, reject) => {
        socket.addEventListener("open", resolve, { once: true });
        socket.addEventListener(
          "error",
          () => reject(new Error(`${label} websocket error before open`)),
          { once: true },
        );
      }),
      SOCKET_TIMEOUT_MS,
      `${label} websocket open`,
    );

    socket.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      for (const waiter of this.waiters) {
        if (!waiter.predicate(message)) continue;
        this.waiters.delete(waiter);
        clearTimeout(waiter.timer);
        waiter.resolve(message);
        return;
      }
      this.queue.push(message);
    });

    socket.addEventListener("close", (event) => {
      this.closed = true;
      for (const waiter of this.waiters) {
        clearTimeout(waiter.timer);
        waiter.reject(
          new Error(`${label} closed before ${waiter.description} (${event.code}: ${event.reason})`),
        );
      }
      this.waiters.clear();
    });
  }

  next(predicate, description, timeoutMs = SOCKET_TIMEOUT_MS) {
    const index = this.queue.findIndex(predicate);
    if (index >= 0) return Promise.resolve(this.queue.splice(index, 1)[0]);
    if (this.closed) return Promise.reject(new Error(`${this.label} is already closed`));

    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        description,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters.delete(waiter);
          reject(new Error(`${this.label} message timed out: ${description}`));
        }, timeoutMs),
      };
      this.waiters.add(waiter);
    });
  }

  send(value) {
    assert.equal(this.socket.readyState, WebSocket.OPEN, `${this.label} socket is not open`);
    this.socket.send(JSON.stringify(value));
  }

  async close() {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    const closed = new Promise((resolve) => {
      this.socket.addEventListener("close", resolve, { once: true });
    });
    this.socket.close(1000, "smoke complete");
    await withTimeout(closed, 3_000, `${this.label} websocket close`).catch(() => undefined);
  }
}

async function verifyStaticApp() {
  const response = await fetchWithTimeout("/");
  assert.equal(response.status, 200, `GET / returned ${response.status}`);
  const contentType = response.headers.get("content-type") ?? "";
  assert.match(contentType, /text\/html/i, `GET / content-type=${contentType}`);
  const html = await response.text();
  assert.match(html, /id=["']app["']/i, "app mount is missing from HTML");
  assert.match(html, /AORI ROOM/i, "AORI ROOM marker is missing from HTML");
}

function verifyReleaseMetadata(release) {
  assert.ok(release && typeof release === "object", "release.json is missing or invalid");
  assert.equal(release.service, "aori-room");
  assert.equal(release.protocolVersion, 2);
  assert.match(String(release.version ?? ""), /^\d+\.\d+\.\d+/);
  assert.ok(typeof release.gitSha === "string" && release.gitSha.length >= 7);
  assert.deepEqual(release.characters, ["lumi", "mio", "sena"]);
}

async function run() {
  const startedAt = Date.now();
  const release = EXPECTED_SHA ? await waitForExpectedRelease() : await fetchRelease();
  verifyReleaseMetadata(release);
  await verifyStaticApp();

  const host = await fetchJson(
    "/api/rooms",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    },
    201,
  );
  assert.match(host.roomCode, /^\d{5}$/);
  assert.equal(host.role, "host");
  assert.match(host.token, /^[0-9a-f]{48}$/i);

  const guest = await fetchJson(
    `/api/rooms/${host.roomCode}/join`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    },
    200,
  );
  assert.equal(guest.roomCode, host.roomCode);
  assert.equal(guest.role, "guest");
  assert.match(guest.token, /^[0-9a-f]{48}$/i);

  hostSocket = await SocketProbe.connect(host, "host");
  const hostWelcome = await hostSocket.next((message) => message.type === "welcome", "host welcome");
  assert.equal(hostWelcome.role, "host");
  assert.equal(hostWelcome.roomCode, host.roomCode);

  const hostSeesGuest = hostSocket.next(
    (message) => message.type === "presence" && message.presence?.guest === true,
    "host sees guest",
  );
  guestSocket = await SocketProbe.connect(guest, "guest");
  const guestWelcome = await guestSocket.next(
    (message) => message.type === "welcome",
    "guest welcome",
  );
  assert.equal(guestWelcome.role, "guest");
  assert.equal(guestWelcome.presence?.host, true);
  await hostSeesGuest;

  const thirdJoin = await fetchJson(
    `/api/rooms/${host.roomCode}/join`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    },
    409,
  );
  assert.match(String(thirdJoin.message ?? ""), /2人|すでに/);

  const hostState = {
    x: 1.25,
    z: -0.5,
    yaw: 0.7,
    speed: 4.1,
    motion: "start-left",
    motionSequence: 9,
    clientTime: 123,
    characterId: "lumi",
  };
  const guestReceivesHost = guestSocket.next(
    (message) => message.type === "state" && message.state?.motionSequence === 9,
    "guest receives host state",
  );
  hostSocket.send({ type: "state", state: hostState });
  assert.deepEqual((await guestReceivesHost).state, hostState);

  const guestState = {
    x: -1.1,
    z: 0.8,
    yaw: -0.4,
    speed: 2.2,
    motion: "sandori",
    motionSequence: 12,
    clientTime: 456,
    characterId: "sena",
  };
  const hostReceivesGuest = hostSocket.next(
    (message) => message.type === "state" && message.state?.motionSequence === 12,
    "host receives guest state",
  );
  guestSocket.send({ type: "state", state: guestState });
  assert.deepEqual((await hostReceivesGuest).state, guestState);

  await new Promise((resolve) => setTimeout(resolve, 35));
  const invalidCharacterReceived = guestSocket.next(
    (message) => message.type === "state" && message.state?.motionSequence === 13,
    "invalid character is sanitized",
  );
  hostSocket.send({
    type: "state",
    state: { ...hostState, motionSequence: 13, characterId: "not-a-character" },
  });
  const sanitizedState = (await invalidCharacterReceived).state;
  assert.equal("characterId" in sanitizedState, false);

  await new Promise((resolve) => setTimeout(resolve, 35));
  const reconnectState = {
    ...hostState,
    motion: "run",
    motionSequence: 14,
    clientTime: 999,
    characterId: "mio",
  };
  const guestReceivesReconnectState = guestSocket.next(
    (message) => message.type === "state" && message.state?.motionSequence === 14,
    "guest receives reconnect baseline",
  );
  hostSocket.send({ type: "state", state: reconnectState });
  assert.deepEqual((await guestReceivesReconnectState).state, reconnectState);

  const bubbleReceived = hostSocket.next(
    (message) => message.type === "bubble" && message.sequence === 7,
    "bubble relay",
  );
  guestSocket.send({ type: "bubble", text: "  ぐるぐる〜\u0000  ", sequence: 7 });
  const bubble = await bubbleReceived;
  assert.equal(bubble.role, "guest");
  assert.equal(bubble.text, "ぐるぐる〜");

  const pongReceived = hostSocket.next((message) => message.type === "pong", "heartbeat pong");
  hostSocket.send({ type: "ping", clientTime: 789 });
  const pong = await pongReceived;
  assert.equal(typeof pong.serverTime, "number");

  const hostSeesDisconnect = hostSocket.next(
    (message) => message.type === "presence" && message.presence?.guest === false,
    "host sees guest disconnect",
  );
  await guestSocket.close();
  guestSocket = undefined;
  await hostSeesDisconnect;

  const hostSeesResume = hostSocket.next(
    (message) => message.type === "presence" && message.presence?.guest === true,
    "host sees guest resume",
  );
  resumedGuestSocket = await SocketProbe.connect(guest, "resumed guest");
  const resumedWelcome = await resumedGuestSocket.next(
    (message) => message.type === "welcome",
    "resumed guest welcome",
  );
  assert.equal(resumedWelcome.role, "guest");
  assert.equal(resumedWelcome.peerState?.characterId, "mio");
  assert.equal(resumedWelcome.peerState?.motionSequence, 14);
  await hostSeesResume;

  const summary = {
    ok: true,
    baseUrl: baseUrl.origin,
    roomCode: host.roomCode,
    release: release
      ? { version: release.version, gitSha: release.gitSha, builtAt: release.builtAt }
      : null,
    checks: [
      "static-app",
      "create-and-join",
      "capacity-limit",
      "presence",
      "bidirectional-state",
      "character-sync",
      "character-allow-list",
      "bubble-sanitization",
      "ping-pong",
      "guest-reconnect",
    ],
    durationMs: Date.now() - startedAt,
  };
  console.log(JSON.stringify(summary, null, 2));
}

try {
  await run();
} finally {
  await Promise.allSettled([
    hostSocket?.close(),
    guestSocket?.close(),
    resumedGuestSocket?.close(),
  ]);
}
