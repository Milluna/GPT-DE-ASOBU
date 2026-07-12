import type { CharacterId } from "./characters";

export type PlayerRole = "host" | "guest";

export type MotionName =
  | "idle"
  | "run"
  | "start-left"
  | "start-right"
  | "sandori"
  | "racket-swing";

export interface PlayerState {
  x: number;
  z: number;
  yaw: number;
  speed: number;
  motion: MotionName;
  motionSequence: number;
  clientTime: number;
  characterId?: CharacterId;
}

export interface PresenceState {
  host: boolean;
  guest: boolean;
}

export interface RoomSession {
  roomCode: string;
  token: string;
  role: PlayerRole;
  expiresAt: number;
  localOnly?: boolean;
}

export interface WelcomeMessage {
  type: "welcome";
  role: PlayerRole;
  roomCode: string;
  expiresAt: number;
  presence: PresenceState;
  peerState?: PlayerState;
}

export interface PresenceMessage {
  type: "presence";
  presence: PresenceState;
}

export interface StateMessage {
  type: "state";
  role: PlayerRole;
  state: PlayerState;
  serverTime: number;
}

export interface BubbleMessage {
  type: "bubble";
  role: PlayerRole;
  text: string;
  sequence: number;
  serverTime: number;
}

export interface PongMessage {
  type: "pong";
  serverTime: number;
}

export interface RoomExpiredMessage {
  type: "expired";
}

export interface ErrorMessage {
  type: "error";
  code: string;
  message: string;
}

export type ServerMessage =
  | WelcomeMessage
  | PresenceMessage
  | StateMessage
  | BubbleMessage
  | PongMessage
  | RoomExpiredMessage
  | ErrorMessage;

export type ClientMessage =
  | { type: "state"; state: PlayerState }
  | { type: "bubble"; text: string; sequence: number }
  | { type: "ping"; clientTime: number };

export type MessageTabs = [string[], string[], string[]];
