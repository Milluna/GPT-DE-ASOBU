import { describe, expect, it } from "vitest";
import { LocomotionController } from "../src/game/locomotion";

function step(
  controller: LocomotionController,
  input: { x: number; y: number },
  frameCount = 1,
  startTime = 0,
): number {
  let now = startTime;
  for (let frame = 0; frame < frameCount; frame += 1) {
    now += 1000 / 60;
    controller.update(1 / 60, input, now);
  }
  return now;
}

describe("LocomotionController", () => {
  it("accelerates, moves, then decelerates after release", () => {
    const controller = new LocomotionController();
    let now = step(controller, { x: 1, y: 0 }, 30);
    expect(controller.speed).toBeGreaterThan(4);
    expect(controller.x).toBeGreaterThan(1);

    now = step(controller, { x: 0, y: 0 }, 20, now);
    expect(controller.speed).toBeLessThan(0.1);
    expect(controller.motion).toBe("idle");
  });

  it("restarts the lateral start motion every time input changes side", () => {
    const controller = new LocomotionController();
    let now = step(controller, { x: -1, y: 0 }, 1);
    const firstSequence = controller.motionSequence;
    expect(controller.motion).toBe("start-left");

    now = step(controller, { x: 1, y: 0 }, 4, now);
    expect(controller.motion).toBe("start-right");
    expect(controller.motionSequence).toBeGreaterThan(firstSequence);

    const secondSequence = controller.motionSequence;
    step(controller, { x: -1, y: 0 }, 4, now);
    expect(controller.motion).toBe("start-left");
    expect(controller.motionSequence).toBeGreaterThan(secondSequence);
  });

  it("detects sustained circular stick input as sandori", () => {
    const controller = new LocomotionController({ startDuration: 0.05 });
    let now = 0;
    let sawSandori = false;
    for (let frame = 0; frame < 100; frame += 1) {
      const angle = frame * 0.14;
      now += 1000 / 60;
      const state = controller.update(
        1 / 60,
        { x: Math.cos(angle), y: Math.sin(angle) },
        now,
      );
      if (state.motion === "sandori") sawSandori = true;
    }
    expect(sawSandori).toBe(true);
  });

  it("blocks a straight crossing through the middle of the net", () => {
    const controller = new LocomotionController();
    step(controller, { x: 0, y: 1 }, 120);
    expect(controller.z).toBeGreaterThanOrEqual(0.34 - 1e-6);
    expect(controller.z).toBeLessThanOrEqual(0.34 + 1e-6);
  });

  it("allows crossing through an open side of the net", () => {
    const controller = new LocomotionController();
    controller.reset(3.1, 1.65, Math.PI);
    step(controller, { x: 0, y: 1 }, 120);
    expect(controller.z).toBeLessThan(-0.5);
  });

  it("keeps the player inside the stage boundary", () => {
    const controller = new LocomotionController();
    step(controller, { x: 1, y: 0 }, 600);
    expect(controller.x).toBeLessThanOrEqual(controller.tuning.boundaryX);
    expect(controller.x).toBeGreaterThanOrEqual(-controller.tuning.boundaryX);
  });
});
