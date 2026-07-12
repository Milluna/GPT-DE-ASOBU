import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] ?? "app";
const pathOf = (file) => join(root, file);
const read = (file) => readFileSync(pathOf(file), "utf8");
const write = (file, content) => writeFileSync(pathOf(file), content);
const replaceOnce = (file, from, to) => {
  const source = read(file);
  if (!source.includes(from)) throw new Error(`Patch anchor missing: ${file}`);
  write(file, source.replace(from, to));
};

write("src/game/floatingStick.ts", `import type { StickInput } from "./locomotion";

const INTERACTIVE_SELECTOR = "button, input, textarea, select, a, [data-no-stick]";

export interface FloatingStickOptions {
  radius?: number;
  activationDistance?: number;
  onPress?: () => void;
  onMoveStart?: () => void;
}

export class FloatingStick {
  readonly element: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  private readonly surface: HTMLElement;
  private readonly radius: number;
  private readonly activationDistance: number;
  private readonly onPress: (() => void) | undefined;
  private readonly onMoveStart: (() => void) | undefined;
  private activePointerId: number | null = null;
  private originX = 0;
  private originY = 0;
  private movementActivated = false;
  private input: StickInput = { x: 0, y: 0 };

  constructor(surface: HTMLElement, overlay: HTMLElement, options: FloatingStickOptions = {}) {
    this.surface = surface;
    this.radius = options.radius ?? 64;
    this.activationDistance = options.activationDistance ?? 9;
    this.onPress = options.onPress;
    this.onMoveStart = options.onMoveStart;
    this.element = document.createElement("div");
    this.element.className = "floating-stick";
    this.element.setAttribute("aria-hidden", "true");
    this.knob = document.createElement("div");
    this.knob.className = "floating-stick__knob";
    this.element.append(this.knob);
    overlay.append(this.element);
    surface.addEventListener("pointerdown", this.onPointerDown, { passive: false });
    surface.addEventListener("pointermove", this.onPointerMove, { passive: false });
    surface.addEventListener("pointerup", this.onPointerEnd, { passive: false });
    surface.addEventListener("pointercancel", this.onPointerEnd, { passive: false });
    surface.addEventListener("lostpointercapture", this.onPointerEnd);
  }

  get value(): StickInput { return this.input; }

  destroy(): void {
    this.surface.removeEventListener("pointerdown", this.onPointerDown);
    this.surface.removeEventListener("pointermove", this.onPointerMove);
    this.surface.removeEventListener("pointerup", this.onPointerEnd);
    this.surface.removeEventListener("pointercancel", this.onPointerEnd);
    this.surface.removeEventListener("lostpointercapture", this.onPointerEnd);
    this.element.remove();
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (this.activePointerId !== null || !event.isPrimary) return;
    const target = event.target;
    if (target instanceof Element && target.closest(INTERACTIVE_SELECTOR)) return;
    event.preventDefault();
    this.activePointerId = event.pointerId;
    this.originX = event.clientX;
    this.originY = event.clientY;
    this.movementActivated = false;
    this.input = { x: 0, y: 0 };
    this.surface.setPointerCapture(event.pointerId);
    this.element.style.left = `\${this.originX}px`;
    this.element.style.top = `\${this.originY}px`;
    this.element.classList.add("is-active");
    this.knob.style.transform = "translate3d(0, 0, 0)";
    this.onPress?.();
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointerId) return;
    event.preventDefault();
    const dx = event.clientX - this.originX;
    const dy = event.clientY - this.originY;
    const distance = Math.hypot(dx, dy);
    const scale = distance > this.radius ? this.radius / distance : 1;
    const x = dx * scale;
    const y = dy * scale;
    if (!this.movementActivated && distance >= this.activationDistance) {
      this.movementActivated = true;
      this.onMoveStart?.();
    }
    this.input = this.movementActivated ? { x: x / this.radius, y: -y / this.radius } : { x: 0, y: 0 };
    this.knob.style.transform = `translate3d(\${x}px, \${y}px, 0)`;
  };

  private readonly onPointerEnd = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointerId) return;
    event.preventDefault();
    if (this.surface.hasPointerCapture(event.pointerId)) this.surface.releasePointerCapture(event.pointerId);
    this.activePointerId = null;
    this.movementActivated = false;
    this.input = { x: 0, y: 0 };
    this.element.classList.remove("is-active");
    this.knob.style.transform = "translate3d(0, 0, 0)";
  };
}
`);

write("src/game/locomotion.ts", `import type { MotionName, PlayerState } from "../types";

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
  sandoriAngularVelocity: 3.7, sandoriHoldSeconds: 0.2, boundaryX: 4.35, boundaryZ: 4.85,
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
    this.x += this.velocityX * dt; this.z += this.velocityZ * dt;
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
`);

write("src/game/remoteInterpolator.ts", `import type { PlayerState } from "../types";
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const damp = (current: number, target: number, sharpness: number, dt: number) => current + (target - current) * (1 - Math.exp(-sharpness * dt));
export class RemoteInterpolator {
  private current: PlayerState; private target: PlayerState; private hasSnapshot = false;
  constructor(initial: PlayerState) { this.current = { ...initial }; this.target = { ...initial }; }
  push(state: PlayerState): void { this.target = { ...state }; if (!this.hasSnapshot) { this.current = { ...state }; this.hasSnapshot = true; } }
  update(dtSeconds: number): PlayerState {
    const dt = clamp(dtSeconds, 0, 0.05);
    this.current.x = damp(this.current.x, this.target.x, 28, dt);
    this.current.z = damp(this.current.z, this.target.z, 28, dt);
    this.current.yaw = this.target.yaw;
    this.current.speed = damp(this.current.speed, this.target.speed, 22, dt);
    this.current.motion = this.target.motion; this.current.motionSequence = this.target.motionSequence;
    this.current.clientTime = this.target.clientTime; return { ...this.current };
  }
}
`);

replaceOnce("src/types.ts", '  | "sandori";', '  | "sandori"\n  | "racket-swing";');
replaceOnce("worker/index.ts", 'type MotionName = "idle" | "run" | "start-left" | "start-right" | "sandori";', 'type MotionName = "idle" | "run" | "start-left" | "start-right" | "sandori" | "racket-swing";');
replaceOnce("worker/index.ts", '  "sandori",\n]);', '  "sandori",\n  "racket-swing",\n]);');
replaceOnce("src/game/game.ts", '    this.stick = new FloatingStick(this.renderer.domElement, this.overlay);', `    this.stick = new FloatingStick(this.renderer.domElement, this.overlay, {
      activationDistance: 9,
      onPress: () => {
        const state = this.controller.triggerRacketSwing(performance.now());
        this.lastLocalState = state;
        this.sendAccumulator = 0;
        this.onLocalState({ ...state });
      },
      onMoveStart: () => { this.sendAccumulator = SEND_INTERVAL_SECONDS; },
    });`);

replaceOnce("src/game/avatar.ts", '  private readonly skirt = new THREE.Group();\n  private readonly shadow: THREE.Mesh;', '  private readonly skirt = new THREE.Group();\n  private readonly racketPivot = new THREE.Group();\n  private readonly shadow: THREE.Mesh;');
replaceOnce("src/game/avatar.ts", `    addOutlinedMesh(this.rightArm, cuffGeometry, clothAccent, {
      position: [0, -0.05, 0],
      outline: 1.045,
    });

    // Head:`, `    addOutlinedMesh(this.rightArm, cuffGeometry, clothAccent, {
      position: [0, -0.05, 0],
      outline: 1.045,
    });
    this.racketPivot.position.set(0, -0.46, 0.02);
    this.rightArm.add(this.racketPivot);
    addOutlinedMesh(this.racketPivot, new THREE.CylinderGeometry(0.035, 0.045, 0.48, 10), dark, { position: [0, -0.2, 0], outline: 1.08 });
    addOutlinedMesh(this.racketPivot, new THREE.TorusGeometry(0.235, 0.034, 9, 28), clothAccent, { position: [0, -0.65, 0], scale: [0.82, 1.14, 1], outline: 1.07 });

    // Head:`);
replaceOnce("src/game/avatar.ts", '    let rightArmZ = 0.04;\n    let skirtZ = 0;\n\n    if (state.motion === "run") {', `    let rightArmZ = 0.04;
    let racketX = 0.18;
    let racketY = 0;
    let racketZ = -0.2;
    let skirtZ = 0;

    if (state.motion === "racket-swing") {
      const t = clamp(this.motionAge / 0.43, 0, 1);
      const strike = t < 0.22 ? t / 0.22 : t < 0.62 ? (t - 0.22) / 0.4 : 1 - (t - 0.62) / 0.38;
      const p = clamp(strike, 0, 1);
      bodyY -= Math.sin(t * Math.PI) * 0.035;
      torsoYaw = (t < 0.22 ? 0.25 : -0.42) * p;
      torsoZ = (t < 0.22 ? 0.08 : -0.12) * p;
      leftArmX = 0.2 * p;
      rightArmX = t < 0.22 ? -0.95 * p : 1.15 * p;
      rightArmZ = t < 0.22 ? -0.88 * p : 0.84 * p;
      racketX = t < 0.22 ? -0.25 * p : 1.1 * p;
      racketY = 0.16 * Math.sin(t * Math.PI * 2);
      racketZ = t < 0.22 ? -1.0 * p : 1.25 * p;
    } else if (state.motion === "run") {`);
replaceOnce("src/game/avatar.ts", '    this.rightArm.rotation.z = damp(this.rightArm.rotation.z, rightArmZ, 20, dt);\n    this.skirt.rotation.z = damp(this.skirt.rotation.z, skirtZ, 16, dt);', `    this.rightArm.rotation.z = damp(this.rightArm.rotation.z, rightArmZ, 20, dt);
    this.racketPivot.rotation.x = damp(this.racketPivot.rotation.x, racketX, 34, dt);
    this.racketPivot.rotation.y = damp(this.racketPivot.rotation.y, racketY, 34, dt);
    this.racketPivot.rotation.z = damp(this.racketPivot.rotation.z, racketZ, 36, dt);
    this.skirt.rotation.z = damp(this.skirt.rotation.z, skirtZ, 16, dt);`);
replaceOnce("vite.config.ts", '    sourcemap: true,', '    sourcemap: false,');
replaceOnce("wrangler.jsonc", '  "name": "aori-room-prototype",', '  "name": "gpt-de-asobu",');

console.log("Applied AORI ROOM v1.1 gesture patch");
