import type { MotionName } from "../types";

export const TAUNT_MOTION_PROFILE_VERSION = "low-stance-taunts-v1" as const;

export interface TauntMotionOverlay {
  visualX: number;
  visualY: number;
  torsoX: number;
  torsoY: number;
  torsoZ: number;
  headY: number;
  headZ: number;
  leftLegX: number;
  rightLegX: number;
  leftLegZ: number;
  rightLegZ: number;
  leftArmX: number;
  rightArmX: number;
  leftArmZ: number;
  rightArmZ: number;
  racketX: number;
  racketY: number;
  racketZ: number;
  skirtX: number;
  skirtZ: number;
}

const EMPTY_OVERLAY: Readonly<TauntMotionOverlay> = Object.freeze({
  visualX: 0,
  visualY: 0,
  torsoX: 0,
  torsoY: 0,
  torsoZ: 0,
  headY: 0,
  headZ: 0,
  leftLegX: 0,
  rightLegX: 0,
  leftLegZ: 0,
  rightLegZ: 0,
  leftArmX: 0,
  rightArmX: 0,
  leftArmZ: 0,
  rightArmZ: 0,
  racketX: 0,
  racketY: 0,
  racketZ: 0,
  skirtX: 0,
  skirtZ: 0,
});

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function smoothStep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function sideStepOverlay(motion: "start-left" | "start-right", ageSeconds: number): TauntMotionOverlay {
  const side = motion === "start-left" ? -1 : 1;
  const t = clamp(ageSeconds / 0.2, 0, 1);

  // Start on the low, wide endpoint pose of a shuttle run. The pose is
  // intentionally non-zero at t=0 so every left/right reversal reads instantly.
  const edgePose = 1 - smoothStep(0, 0.58, t);
  const rebound = Math.sin(t * Math.PI);
  const crouch = clamp(0.92 * edgePose + 0.74 * rebound, 0, 1);
  const outsideLegX = -0.22 * edgePose - 0.1 * rebound;
  const insideLegX = 0.28 * edgePose + 0.12 * rebound;
  const outsideLegZ = side * (0.34 * edgePose + 0.18 * rebound);
  const insideLegZ = side * (0.14 * edgePose + 0.08 * rebound);
  const outsideArmX = 0.46 * edgePose + 0.18 * rebound;
  const insideArmX = -0.16 * edgePose - 0.08 * rebound;

  return {
    ...EMPTY_OVERLAY,
    visualX: side * (0.06 * edgePose + 0.045 * rebound),
    visualY: -0.17 * crouch,
    torsoX: 0.23 * crouch,
    torsoY: side * (0.1 * edgePose + 0.05 * rebound),
    torsoZ: -side * (0.22 * edgePose + 0.13 * rebound),
    headY: -side * 0.035 * edgePose,
    headZ: side * (0.11 * edgePose + 0.05 * rebound),
    leftLegX: side < 0 ? outsideLegX : insideLegX,
    rightLegX: side > 0 ? outsideLegX : insideLegX,
    leftLegZ: side < 0 ? outsideLegZ : insideLegZ,
    rightLegZ: side > 0 ? outsideLegZ : insideLegZ,
    leftArmX: side < 0 ? outsideArmX : insideArmX,
    rightArmX: side > 0 ? outsideArmX : insideArmX,
    leftArmZ: side < 0 ? -0.1 * crouch : 0.06 * crouch,
    rightArmZ: side > 0 ? 0.1 * crouch : -0.06 * crouch,
    skirtX: 0.035 * crouch,
    skirtZ: -side * 0.09 * crouch,
  };
}

function racketSwingOverlay(ageSeconds: number): TauntMotionOverlay {
  const t = clamp(ageSeconds / 0.43, 0, 1);

  // Begin already coiled and low, then deepen the wind-up during the first
  // frames before driving the racket forward. This removes the upright pause.
  const earlyLoad =
    t < 0.12
      ? 0.78 + 0.22 * smoothStep(0, 0.12, t)
      : 1 - smoothStep(0.12, 0.44, t);
  const forwardDrive = smoothStep(0.04, 0.5, t) * (1 - smoothStep(0.64, 1, t));
  const crouchBuild = 0.88 + 0.12 * smoothStep(0, 0.28, t);
  const crouch = crouchBuild * (1 - 0.78 * smoothStep(0.7, 1, t));

  return {
    ...EMPTY_OVERLAY,
    visualY: -0.18 * crouch,
    torsoX: 0.25 * crouch,
    torsoY: -0.26 * earlyLoad + 0.38 * forwardDrive,
    torsoZ: -0.09 * crouch,
    headY: 0.11 * earlyLoad - 0.08 * forwardDrive,
    headZ: 0.04 * forwardDrive,
    leftLegX: 0.08 * crouch,
    rightLegX: -0.08 * crouch,
    leftLegZ: -0.2 * crouch,
    rightLegZ: 0.2 * crouch,
    leftArmX: -0.18 * crouch - 0.12 * forwardDrive,
    rightArmX: 0.92 * earlyLoad - 1.05 * forwardDrive,
    leftArmZ: -0.1 * crouch,
    rightArmZ: 0.62 * earlyLoad - 0.72 * forwardDrive,
    racketX: 0.72 * earlyLoad - 0.92 * forwardDrive,
    racketY: 0.1 * forwardDrive,
    racketZ: 0.78 * earlyLoad - 1.05 * forwardDrive,
    skirtX: 0.05 * crouch,
    skirtZ: -0.05 * crouch + 0.08 * forwardDrive,
  };
}

export function computeTauntMotionOverlay(
  motion: MotionName,
  ageSeconds: number,
): TauntMotionOverlay {
  if (motion === "start-left" || motion === "start-right") {
    return sideStepOverlay(motion, Math.max(0, ageSeconds));
  }
  if (motion === "racket-swing") {
    return racketSwingOverlay(Math.max(0, ageSeconds));
  }
  return { ...EMPTY_OVERLAY };
}
