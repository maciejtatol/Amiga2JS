import { describe, expect, it } from "vitest";
import type { HorizontalMovementIR } from "@retroport/schemas";
import { runPhase0AcceptanceSuite, verifyScenario } from "../src/index.js";

const ir: HorizontalMovementIR = {
  tick: { unit: "frame", rateHz: 50 }, position: { bits: 16, signed: true }, velocity: { bits: 16, signed: true },
  inputMapping: { left: -2, idle: 0, right: 2 }, updateOrder: ["read-input", "set-velocity", "apply-velocity"],
};

describe("behavioral verification", () => {
  it("passes a matching deterministic replay", () => {
    const result = verifyScenario("movement", { playerX: 0, velocityX: 0, tickCounter: 0 }, ["RIGHT", "RIGHT", "NONE"], ir, [
      { scenarioId: "movement", tick: 0, input: "RIGHT", state: { playerX: 2, velocityX: 2, tickCounter: 1 } },
      { scenarioId: "movement", tick: 1, input: "RIGHT", state: { playerX: 4, velocityX: 2, tickCounter: 2 } },
      { scenarioId: "movement", tick: 2, input: "NONE", state: { playerX: 4, velocityX: 0, tickCounter: 3 } },
    ]);
    expect(result.passed).toBe(true);
    expect(result.mismatch).toBeNull();
  });

  it("reports the first divergent tick", () => {
    const result = verifyScenario("movement", { playerX: 0, velocityX: 0, tickCounter: 0 }, ["RIGHT", "RIGHT"], ir, [
      { scenarioId: "movement", tick: 0, input: "RIGHT", state: { playerX: 2, velocityX: 2, tickCounter: 1 } },
      { scenarioId: "movement", tick: 1, input: "RIGHT", state: { playerX: 9, velocityX: 2, tickCounter: 2 } },
    ]);
    expect(result.passed).toBe(false);
    expect(result.mismatch).toEqual({ tick: 1, field: "playerX", expected: 4, actual: 9 });
  });

  it("rejects observations from another scenario", () => {
    expect(() => verifyScenario("movement", { playerX: 0, velocityX: 0, tickCounter: 0 }, [], ir, [
      { scenarioId: "other", tick: 0, input: "NONE", state: { playerX: 0 } },
    ])).toThrow();
  });

  it("rejects an observation with the wrong input at a known tick", () => {
    expect(() => verifyScenario("movement", { playerX: 0, velocityX: 0, tickCounter: 0 }, ["RIGHT"], ir, [
      { scenarioId: "movement", tick: 0, input: "LEFT", state: { playerX: 2, velocityX: 2, tickCounter: 1 } },
    ])).toThrow("input does not match");
  });

  it("passes the three deterministic 1000-tick acceptance replays", () => {
    const result = runPhase0AcceptanceSuite(ir);
    expect(result.passed).toBe(true);
    expect(result.scenarios.map(({ id, ticks }) => [id, ticks])).toEqual([
      ["constant-left", 1000], ["constant-right", 1000], ["constant-none", 1000],
    ]);
    expect(result.scenarios.every(({ verification }) => verification.mismatch === null)).toBe(true);
  });
});
