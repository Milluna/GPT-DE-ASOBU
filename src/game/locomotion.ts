import type { MotionName, PlayerState } from "../types";

export interface StickInput { x: number; y: number; }
export interface LocomotionTuning {
  deadZone: number; maxSpeed: number; acceleration: number; deceleration: number;
  turnSharpness: number; neutralReturnDelay: number; startThreshold: number;
  startReleaseThreshold: number; lateralStartRatio: number; startDuration: number;
  startRetriggerCooldownMs: number; racketSwingDuration: number;
  sandoriAngularVelocity: number; sandoriHoldSeconds: number; boundaryX: number; boundaryZ: number;
}
export const DEFAULT_LOCOMOTION_TUNING: LocomotionTuning = {
  deadZone: 0.075, maxSpeed: 4.85, acceleration: 27.5, deceleration: 35,
  turnSharpness: 24, neutralReturnDelay: 0.08, startThreshold: 0.34,
  startReleaseThreshold: 0.18, lateralStartRatio: 0.82, startDuration: 0.19,
  startRetriggerCooldownMs: 48, racketSwingDuration: 0.43,
  sandoriAngularVelocity: 3.7, sandoriHoldSeconds: 0.2, boundaryX: 4.12, boundaryZ: 4.85,
};
const EPSILON = 1e-6;
const TWO_PI = Math.PI * 2;
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
function wrapAngle(v: number): number { let r = v % TWO_PI; if (r > Math.PI) r -= TWO_PI; if (r < -Math.PI) r += TWO_PI; return r; }
function angleDelta(target: number, current: number): number { return wrapAngle(target - current); }
function dampAngle(current: number, target: number, sharpness: number, dt: number): number { return wrapAngle(current + angleDelta(target, current) * (1 - Math.exp(-sharpness * dt))); }
function moveToward(current: number, target: number, delta: number): number { return Math.abs(target - current) <= delta ? target : current + Math.sign(target - current) * delta; }
function responseCurve(v: number): number { const s = v * v * (3 - 2 * v); return Math.pow(s, 0.78); }

export class LocomotionController {
  readonly tuning: LocomotionTuning;
  x = 0; z = 1.65; velocityX = 0; velocityZ = 0; yaw = Math.PI; speed = 0;
  motion: MotionName = "idle"; motionSequence = 0;
  private neutralYaw = Math.PI; private directionX = 0; private directionZ = -1;
  private idleTimer = 0; private startTimer = 0; private swingTimer = 0; private sandoriTimer = 0;
  private activeStartSide: -1 | 0 | 1 = 0; private latchedInputSide: -1 | 0 | 1 = 0;
  private lastStartAtMs = -Infinity; private lastInputAngle: number | null = null;
  private angularVelocity = 0; private wasSandori = false;
  constructor(tuning: Partial<LocomotionTuning> = {}) { this.tuning = { ...DEFAULT_LOCOMOTION_TUNING, ...tuning }; }
  reset(x = 0, z = 1.65, yaw = Math.PI): void {
    this.x = x; this.z = z; this.velocityX = 0; this.velocityZ = 0; this.yaw = yaw;
    this.neutralYaw = yaw; this.directionX = Math.sin(yaw); this.directionZ = Math.cos(yaw);
    this.speed = 0; this.motion = "idle"; this.motionSequence = 0; this.idleTimer = 0;
    this.startTimer = 0; this.swingTimer = 0; this.sandoriTimer = 0; this.activeStartSide = 0;
    this.latchedInputSide = 0; this.lastStartAtMs = -Infinity; this.lastInputAngle = null;
    this.angularVelocity = 0; this.wasSandori = false;
  }
  triggerRacketSwing(nowMs = performance.now()): PlayerState {
    this.swingTimer = this.tuning.racketSwingDuration; this.startTimer = 0; this.sandoriTimer = 0;
    this.activeStartSide = 0; this.wasSandori = false; this.motion = "racket-swing";
    this.motionSequence += 1; return this.snapshot(nowMs);
  }
  update(dtSeconds: number, input: StickInput, nowMs: number): PlayerState {
    const dt = clamp(Number.isFinite(dtSeconds) ? dtSeconds : 0, 0, 0.05);
    const ix = clamp(Number.isFinite(input.x) ? input.x : 0, -1, 1);
    const iy = clamp(Number.isFinite(input.y) ? input.y : 0, -1, 1);
    const raw = Math.min(1, Math.hypot(ix, iy));
    const magnitude = clamp((raw - this.tuning.deadZone) / (1 - this.tuning.deadZone), 0, 1);
    const hasInput = magnitude > 0;
    let dx = this.directionX, dz = this.directionZ;
    if (raw > EPSILON) { dx = ix / raw; dz = -iy / raw; }
    this.startTimer = Math.max(0, this.startTimer - dt);
    this.swingTimer = Math.max(0, this.swingTimer - dt);
    this.sandoriTimer = Math.max(0, this.sandoriTimer - dt);
    if (hasInput) {
      this.swingTimer = 0; this.idleTimer = 0; this.directionX = dx; this.directionZ = dz;
      this.speed = moveToward(this.speed, this.tuning.maxSpeed * responseCurve(magnitude), this.tuning.acceleration * dt);
      this.velocityX = dx * this.speed; this.velocityZ = dz * this.speed;
    } else {
      this.idleTimer += dt; this.speed = moveToward(this.speed, 0, this.tuning.deceleration * dt);
      if (this.speed <= 0.01) { this.speed = 0; this.velocityX = 0; this.velocityZ = 0; }
      else { this.velocityX = this.directionX * this.speed; this.velocityZ = this.directionZ * this.speed; }
      if (this.speed <= 0.08 && this.idleTimer >= this.tuning.neutralReturnDelay) this.yaw = dampAngle(this.yaw, this.neutralYaw, this.tuning.turnSharpness, dt);
    }
    this.updateInputAngularVelocity(dt, ix, iy, raw);
    this.updateStartTrigger(ix, iy, raw, nowMs);
    const sideStart = hasInput && this.startTimer > 0 && this.activeStartSide !== 0;
    if (hasInput) this.yaw = sideStart ? this.neutralYaw : Math.atan2(dx, dz);
    const oldX = this.x;
    const oldZ = this.z;
    let nextX = oldX + this.velocityX * dt;
    let nextZ = oldZ + this.velocityZ * dt;
    const netHalfWidth = 2.15;
    const netHalfDepth = 0.10;
    const playerRadius = 0.24;
    const blockedHalfWidth = netHalfWidth + playerRadius;
    const blockedHalfDepth = netHalfDepth + playerRadius;
    const entersNetBand =
      (oldZ < -blockedHalfDepth && nextZ >= -blockedHalfDepth) ||
      (oldZ > blockedHalfDepth && nextZ <= blockedHalfDepth) ||
      (Math.abs(oldZ) <= blockedHalfDepth && Math.abs(nextZ) <= blockedHalfDepth);
    if (entersNetBand && Math.abs(nextX) < blockedHalfWidth) {
      nextZ = oldZ < 0 ? -blockedHalfDepth : blockedHalfDepth;
      this.velocityZ = 0;
    }
    this.x = nextX;
    this.z = nextZ;
    if (this.x < -this.tuning.boundaryX || this.x > this.tuning.boundaryX) { this.x = clamp(this.x, -this.tuning.boundaryX, this.tuning.boundaryX); this.velocityX = 0; }
    if (this.z < -this.tuning.boundaryZ || this.z > this.tuning.boundaryZ) { this.z = clamp(this.z, -this.tuning.boundaryZ, this.tuning.boundaryZ); this.velocityZ = 0; }
    this.speed = Math.hypot(this.velocityX, this.velocityZ);
    const circular = hasInput && magnitude > 0.5 && this.speed > 1.15 && Math.abs(this.angularVelocity) >= this.tuning.sandoriAngularVelocity;
    if (circular) this.sandoriTimer = this.tuning.sandoriHoldSeconds;
    const sandori = hasInput && !sideStart && this.sandoriTimer > 0;
    if (sandori && !this.wasSandori) this.motionSequence += 1;
    this.wasSandori = sandori;
    if (sideStart) this.motion = this.activeStartSide < 0 ? "start-left" : "start-right";
    else if (sandori) this.motion = "sandori";
    else if (hasInput) this.motion = "run";
    else if (this.swingTimer > 0) this.motion = "racket-swing";
    else if (this.speed > 0.08) this.motion = "run";
    else this.motion = "idle";
    return this.snapshot(nowMs);
  }
  snapshot(clientTime = performance.now()): PlayerState { return { x: this.x, z: this.z, yaw: this.yaw, speed: this.speed, motion: this.motion, motionSequence: this.motionSequence, clientTime }; }
  private updateInputAngularVelocity(dt: number, x: number, y: number, raw: number): void {
    if (raw < 0.28 || dt <= 0) { this.lastInputAngle = null; this.angularVelocity = 0; return; }
    const angle = Math.atan2(y, x);
    if (this.lastInputAngle !== null) this.angularVelocity = angleDelta(angle, this.lastInputAngle) / dt;
    this.lastInputAngle = angle;
  }
  private updateStartTrigger(x: number, y: number, raw: number, nowMs: number): void {
    const lateral = raw > EPSILON ? x / raw : 0;
    const nearLateral = raw > 0.3 && Math.abs(lateral) >= this.tuning.lateralStartRatio;
    let side: -1 | 0 | 1 = 0;
    if (nearLateral && Math.abs(x) >= this.tuning.startThreshold) side = x < 0 ? -1 : 1;
    if (!nearLateral || Math.abs(x) <= this.tuning.startReleaseThreshold || raw <= 0.22) this.latchedInputSide = 0;
    if (side === 0 && raw > 0.3) { this.startTimer = 0; this.activeStartSide = 0; }
    const changed = side !== 0 && side !== this.latchedInputSide;
    if (changed && nowMs - this.lastStartAtMs >= this.tuning.startRetriggerCooldownMs) {
      this.latchedInputSide = side; this.activeStartSide = side; this.startTimer = this.tuning.startDuration;
      this.lastStartAtMs = nowMs; this.motionSequence += 1;
    }
  }
}
