import { describe, expect, it } from "vitest";
import {
  analyzeHorizontalMovement,
  gradeHorizontalMovement,
  movementCandidateToIR,
  reviewHorizontalMovement,
  type MovementCandidate,
} from "../src/index.js";
import type { RuntimeObservation } from "@retroport/runtime-amiberry";
import type { StaticAnalysisSnapshot } from "@retroport/static-analysis";

const observations: RuntimeObservation[] = [
  { scenarioId: "left", tick: 0, input: "LEFT", state: { playerX: 0, cameraX: 0 } },
  { scenarioId: "left", tick: 1, input: "LEFT", state: { playerX: -2, cameraX: 0 } },
  { scenarioId: "left", tick: 2, input: "NONE", state: { playerX: -2, cameraX: 0 } },
  { scenarioId: "right", tick: 0, input: "RIGHT", state: { playerX: 0, cameraX: 1 } },
  { scenarioId: "right", tick: 1, input: "RIGHT", state: { playerX: 2, cameraX: 2 } },
  { scenarioId: "right", tick: 2, input: "NONE", state: { playerX: 2, cameraX: 2 } },
  { scenarioId: "none", tick: 0, input: "NONE", state: { playerX: 0, cameraX: 5 } },
  { scenarioId: "none", tick: 1, input: "NONE", state: { playerX: 0, cameraX: 5 } },
],
  staticSnapshot: StaticAnalysisSnapshot = {
    program: { format: "HUNK", languageId: "m68k", imageBase: "0x1000" },
    memoryBlocks: [],
    functions: [{
      address: "0x1000", ghidraName: "update_player", size: 12,
      callers: [], callees: [], reads: [],
      writes: [{ address: "playerX", size: 2 }], disassembly: "move.w",
    }],
    xrefs: [], strings: [], symbols: [], hardwareAccessCandidates: [],
  };

const irMetadata = {
  tick: { unit: "frame" as const, rateHz: 50 },
  position: { bits: 16 as const, signed: true as const },
  velocity: { bits: 16 as const, signed: true as const },
  updateOrder: ["read-input", "set-velocity", "apply-velocity"] as [
    "read-input", "set-velocity", "apply-velocity",
  ],
};

describe("horizontal reconstruction agents", () => {
  it("infers one candidate and correlates its static writer", () => {
    const result = analyzeHorizontalMovement(observations, staticSnapshot);
    expect(result.status).toBe("success");
    expect(result.output.selected).toMatchObject({
      field: "playerX",
      inputMapping: { left: -2, idle: 0, right: 2 },
      writerAddresses: ["0x1000"],
      evidenceIds: [
        "runtime-observation:left:1",
        "runtime-observation:left:2",
        "runtime-observation:right:1",
      ],
    });
  });

  it("independently approves complete deterministic evidence", () => {
    const analysis = analyzeHorizontalMovement(observations);
    const review = reviewHorizontalMovement(analysis.output.selected, observations);
    expect(review.status).toBe("success");
    expect(review.output).toMatchObject({ approved: true, candidateField: "playerX" });
  });

  it("bridges a candidate to IR only with explicit execution metadata", () => {
    const analysis = analyzeHorizontalMovement(observations);
    expect(movementCandidateToIR(analysis.output.selected!, irMetadata)).toMatchObject({
      tick: { unit: "frame", rateHz: 50 },
      inputMapping: { left: -2, idle: 0, right: 2 },
    });
  });

  it("grades the reviewed candidate against separate ground truth", () => {
    const analysis = analyzeHorizontalMovement(observations, staticSnapshot);
    const result = gradeHorizontalMovement(analysis.output.selected!, {
      field: "playerX",
      inputMapping: { left: -2, idle: 0, right: 2 },
      writerAddresses: ["0x1000"],
    });
    expect(result.status).toBe("success");
    expect(result.output.passed).toBe(true);
  });

  it("blocks grading when source ground truth disagrees", () => {
    const analysis = analyzeHorizontalMovement(observations, staticSnapshot);
    const result = gradeHorizontalMovement(analysis.output.selected!, {
      field: "playerX",
      inputMapping: { left: -1, idle: 0, right: 1 },
      writerAddresses: ["0x2000"],
    });
    expect(result.status).toBe("blocked");
    expect(result.output).toMatchObject({
      passed: false,
      inputMappingMatch: false,
      writerAddressesMatch: false,
    });
    expect(result.nextActions[0]?.priority).toBe("high");
  });

  it("blocks incomplete evidence instead of guessing", () => {
    const result = analyzeHorizontalMovement(observations.filter(({ scenarioId }) => scenarioId !== "none"));
    expect(result.status).toBe("blocked");
    expect(result.output.selected).toBeNull();
    expect(result.nextActions[0]?.priority).toBe("high");
  });

  it("reports a reviewer divergence", () => {
    const analysis = analyzeHorizontalMovement(observations);
    const candidate = analysis.output.selected as MovementCandidate;
    const changed = observations.map((observation) => observation.scenarioId === "right" && observation.tick === 1
      ? { ...observation, state: { ...observation.state, playerX: 3 } }
      : observation);
    const review = reviewHorizontalMovement(candidate, changed);
    expect(review.status).toBe("blocked");
    expect(review.output.concerns[0]).toContain("Unexpected playerX delta");
  });
});
