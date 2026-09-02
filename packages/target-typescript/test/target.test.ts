import { describe, expect, it } from "vitest";
import { generateSimulationSource, simulateScenario, stepSimulation } from "../src/index.js";
import type { HorizontalMovementIR } from "@retroport/schemas";

const ir: HorizontalMovementIR = {
  tick: { unit: "frame", rateHz: 50 }, position: { bits: 16, signed: true }, velocity: { bits: 16, signed: true },
  inputMapping: { left: -2, idle: 0, right: 2 }, updateOrder: ["read-input", "set-velocity", "apply-velocity"],
};

describe("TypeScript target", () => {
  it("applies IR semantics one tick at a time", () => {
    expect(stepSimulation({ playerX: 10, velocityX: 0, tickCounter: 4 }, "LEFT", ir))
      .toEqual({ playerX: 8, velocityX: -2, tickCounter: 5 });
  });

  it("simulates inputs in deterministic order with wrapping", () => {
    expect(simulateScenario({ playerX: 32767, velocityX: 0, tickCounter: 0xffffffff }, ["RIGHT", "NONE"], ir))
      .toEqual([{ playerX: -32767, velocityX: 2, tickCounter: 0 }, { playerX: -32767, velocityX: 0, tickCounter: 1 }]);
  });

  it("emits stable source from validated IR", () => {
    expect(generateSimulationSource(ir)).toContain('velocityX = input === "LEFT" ? -2');
    expect(generateSimulationSource(ir)).toBe(generateSimulationSource(structuredClone(ir)));
  });
});
