import { describe, expect, it } from "vitest";
import { RemoteInterpolator } from "../src/game/remoteInterpolator";
import type { PlayerState } from "../src/types";

const initial: PlayerState = {
  x: 0,
  z: 0,
  yaw: Math.PI - 0.1,
  speed: 0,
  motion: "idle",
  motionSequence: 0,
  clientTime: 0,
};

describe("RemoteInterpolator", () => {
  it("adopts the first snapshot immediately", () => {
    const interpolator = new RemoteInterpolator(initial);
    interpolator.push({
      ...initial,
      x: 2,
      motion: "start-left",
      motionSequence: 3,
    });
    const state = interpolator.update(1 / 60);
    expect(state.x).toBe(2);
    expect(state.motion).toBe("start-left");
    expect(state.motionSequence).toBe(3);
  });

  it("smooths later position snapshots while applying motion events without delay", () => {
    const interpolator = new RemoteInterpolator(initial);
    interpolator.push(initial);
    interpolator.update(1 / 60);
    interpolator.push({
      ...initial,
      x: 4,
      speed: 4,
      motion: "sandori",
      motionSequence: 8,
      clientTime: 100,
    });
    const state = interpolator.update(1 / 60);
    expect(state.x).toBeGreaterThan(0);
    expect(state.x).toBeLessThan(4);
    expect(state.motion).toBe("sandori");
    expect(state.motionSequence).toBe(8);
  });
});
