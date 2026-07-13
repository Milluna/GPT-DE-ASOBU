import { describe, expect, it } from "vitest";
import {
  computeTauntMotionOverlay,
  TAUNT_MOTION_PROFILE_VERSION,
} from "../src/game/tauntMotionOverlay";

describe("low-stance taunt motion profile", () => {
  it("starts both side steps on a low, mirrored shuttle-run endpoint pose", () => {
    const left = computeTauntMotionOverlay("start-left", 0);
    const right = computeTauntMotionOverlay("start-right", 0);

    expect(TAUNT_MOTION_PROFILE_VERSION).toBe("low-stance-taunts-v1");
    expect(left.visualY).toBeLessThan(-0.15);
    expect(right.visualY).toBeLessThan(-0.15);
    expect(left.torsoX).toBeGreaterThan(0.2);
    expect(right.torsoX).toBeGreaterThan(0.2);
    expect(left.torsoZ).toBeCloseTo(-right.torsoZ, 6);
    expect(left.leftLegZ).toBeLessThan(-0.3);
    expect(right.rightLegZ).toBeGreaterThan(0.3);
    expect(left.leftLegX).toBeLessThan(0);
    expect(right.rightLegX).toBeLessThan(0);
  });

  it("begins racket taunting already crouched and coiled", () => {
    const start = computeTauntMotionOverlay("racket-swing", 0);
    const firstFrames = computeTauntMotionOverlay("racket-swing", 0.05);

    expect(start.visualY).toBeLessThan(-0.15);
    expect(start.torsoX).toBeGreaterThan(0.2);
    expect(start.leftLegZ).toBeLessThan(-0.15);
    expect(start.rightLegZ).toBeGreaterThan(0.15);
    expect(start.rightArmX).toBeGreaterThan(0.65);
    expect(start.racketZ).toBeGreaterThan(0.55);
    expect(Math.abs(firstFrames.rightArmX - start.rightArmX)).toBeGreaterThan(0.08);
    expect(firstFrames.visualY).toBeLessThan(-0.16);
  });

  it("does not alter unrelated motions", () => {
    expect(computeTauntMotionOverlay("idle", 0.4)).toEqual(
      expect.objectContaining({
        visualX: 0,
        visualY: 0,
        torsoX: 0,
        racketZ: 0,
      }),
    );
  });
});
