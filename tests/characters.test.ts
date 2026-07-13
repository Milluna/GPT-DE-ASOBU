import { describe, expect, it } from "vitest";
import {
  CHARACTER_DEFINITIONS,
  DEFAULT_CHARACTER_ID,
  getCharacterDefinition,
  isCharacterId,
} from "../src/characters";
import { RemoteInterpolator } from "../src/game/remoteInterpolator";
import type { PlayerState } from "../src/types";

describe("character registry", () => {
  it("exposes three unique original characters", () => {
    const ids = CHARACTER_DEFINITIONS.map((character) => character.id);
    expect(ids).toEqual(["lumi", "mio", "sena"]);
    expect(new Set(ids).size).toBe(3);
    expect(CHARACTER_DEFINITIONS.every((character) => character.name.length > 0)).toBe(true);
  });

  it("validates ids and falls back safely", () => {
    expect(isCharacterId("mio")).toBe(true);
    expect(isCharacterId("unknown")).toBe(false);
    expect(getCharacterDefinition(undefined).id).toBe(DEFAULT_CHARACTER_ID);
  });

  it("carries the selected character through remote interpolation", () => {
    const initial: PlayerState = {
      x: 0,
      z: 0,
      yaw: 0,
      speed: 0,
      motion: "idle",
      motionSequence: 0,
      clientTime: 0,
      characterId: "lumi",
    };
    const interpolator = new RemoteInterpolator(initial);
    interpolator.push({ ...initial, x: 2, characterId: "sena" });
    expect(interpolator.update(1 / 60).characterId).toBe("sena");
  });
});
