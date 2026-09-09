import { describe, expect, it } from "vitest";
import { runPhase0Pipeline } from "../src/index.js";

const scenarios = [
  { id: "left", inputs: ["LEFT", "LEFT", "NONE"] as const },
  { id: "right", inputs: ["RIGHT", "RIGHT", "NONE"] as const },
  { id: "none", inputs: ["NONE", "NONE"] as const },
];

const metadata = {
  tick: { unit: "frame" as const, rateHz: 50 },
  position: { bits: 16 as const, signed: true as const },
  velocity: { bits: 16 as const, signed: true as const },
  updateOrder: ["read-input", "set-velocity", "apply-velocity"] as [
    "read-input", "set-velocity", "apply-velocity",
  ],
};

const step = (state: Readonly<Record<string, number>>, input: "LEFT" | "RIGHT" | "NONE") => {
  if (state.playerX === undefined || state.tickCounter === undefined) {
    throw new Error("fixture state is missing movement fields");
  }
  const velocityX = input === "LEFT" ? -2 : input === "RIGHT" ? 2 : 0;
  return {
    playerX: state.playerX + velocityX,
    velocityX,
    tickCounter: state.tickCounter + 1,
  };
};

describe("Phase 0 pipeline", () => {
  it("runs reconstruction through verification and grading", () => {
    const result = runPhase0Pipeline({
      scenarios,
      initialState: { playerX: 0, velocityX: 0, tickCounter: 0 },
      step,
      metadata,
      groundTruth: {
        field: "playerX",
        inputMapping: { left: -2, idle: 0, right: 2 },
        writerAddresses: [],
      },
    });
    expect(result.passed).toBe(true);
    expect(result.analysis.status).toBe("success");
    expect(result.review.status).toBe("success");
    expect(result.ir?.inputMapping).toEqual({ left: -2, idle: 0, right: 2 });
    expect(result.verification.every(({ passed }) => passed)).toBe(true);
    expect(result.grade?.status).toBe("success");
    expect(result.generatedSource).toContain("export function step");
  });

  it("blocks when the fixture does not cover all input channels", () => {
    const result = runPhase0Pipeline({
      scenarios: scenarios.slice(0, 2),
      initialState: { playerX: 0, velocityX: 0, tickCounter: 0 },
      step,
      metadata,
      groundTruth: {
        field: "playerX",
        inputMapping: { left: -2, idle: 0, right: 2 },
        writerAddresses: [],
      },
    });
    expect(result.passed).toBe(false);
    expect(result.ir).toBeNull();
    expect(result.grade).toBeNull();
  });
});
