import type { PlayerState } from "../types";

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const damp = (current: number, target: number, sharpness: number, dt: number): number =>
  current + (target - current) * (1 - Math.exp(-sharpness * dt));

export class RemoteInterpolator {
  private current: PlayerState;
  private target: PlayerState;
  private hasSnapshot = false;

  constructor(initial: PlayerState) {
    this.current = { ...initial };
    this.target = { ...initial };
  }

  push(state: PlayerState): void {
    this.target = { ...state };
    if (!this.hasSnapshot) {
      this.current = { ...state };
      this.hasSnapshot = true;
    }
  }

  update(dtSeconds: number): PlayerState {
    const dt = clamp(dtSeconds, 0, 0.05);
    this.current.x = damp(this.current.x, this.target.x, 28, dt);
    this.current.z = damp(this.current.z, this.target.z, 28, dt);
    this.current.yaw = this.target.yaw;
    this.current.speed = damp(this.current.speed, this.target.speed, 22, dt);
    this.current.motion = this.target.motion;
    this.current.motionSequence = this.target.motionSequence;
    this.current.clientTime = this.target.clientTime;
    if (this.target.characterId) this.current.characterId = this.target.characterId;
    return { ...this.current };
  }
}
