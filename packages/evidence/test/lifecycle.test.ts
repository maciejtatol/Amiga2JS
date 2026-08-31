import {
  generationGateDecisionSchema,
  lifecycleExperimentSchema,
  type LifecycleEvidenceRecord,
  type LifecycleExperiment,
  type SemanticAssertion,
} from "@retroport/schemas";
import { describe, expect, it } from "vitest";
import { evaluateEvidenceLifecycle, generationGateAgentResult } from "../src/index.js";

const assertion: SemanticAssertion = { id: "movement", claim: "input controls horizontal velocity", analystId: "analyst-a", evidenceIds: ["static-1", "trace-1"], predictions: ["right input increases x"] };
const evidence: LifecycleEvidenceRecord[] = [
  { id: "static-1", channel: "static-analysis" as const, producer: { actorId: "tool-a", role: "tool" as const }, summary: "write found" },
  { id: "trace-1", channel: "dynamic-trace" as const, producer: { actorId: "tool-b", role: "tool" as const }, summary: "write observed" },
];
const verifier: LifecycleExperiment = { id: "experiment-1", assertionId: "movement", producer: { actorId: "verifier-b", role: "verifier" }, status: "passed", outcome: "supporting", deterministic: true, testedPredictions: ["right input increases x"], evidenceIds: ["trace-1"] };
const assess = (experiments: readonly LifecycleExperiment[] = [], records: readonly LifecycleEvidenceRecord[] = evidence, value: SemanticAssertion = assertion) => evaluateEvidenceLifecycle({ assertions: [value], evidence: records, experiments }).assessments[0]?.status;

describe("evidence lifecycle", () => {
  it("keeps one channel at hypothesis and supports two channels without an experiment", () => {
    expect(assess([], [evidence[0]!], { ...assertion, evidenceIds: ["static-1"] })).toBe("HYPOTHESIS");
    const decision = evaluateEvidenceLifecycle({ assertions: [assertion], evidence, experiments: [] });
    expect(decision).toMatchObject({ decision: "allow", faithfulGeneration: true });
    expect(decision.assessments[0]?.status).toBe("SUPPORTED");
  });

  it("verifies only with a complete independent deterministic verifier experiment", () => {
    expect(assess([verifier])).toBe("VERIFIED");
    expect(generationGateAgentResult({ assertions: [assertion], evidence, experiments: [verifier] }).status).toBe("success");
    for (const invalid of [
      { ...verifier, deterministic: false },
      { ...verifier, producer: { actorId: "analyst-a", role: "verifier" as const } },
      { ...verifier, producer: { actorId: "other", role: "experimenter" as const } },
      { ...verifier, testedPredictions: ["unrelated"] },
    ]) expect(assess([invalid])).toBe("SUPPORTED");
  });

  it("keeps three channels supported without a verifier experiment", () => {
    const extra = { id: "manual-1", channel: "manual-observation" as const, producer: { actorId: "reviewer", role: "reviewer" as const }, summary: "observed" };
    expect(assess([], [...evidence, extra], { ...assertion, evidenceIds: ["static-1", "trace-1", "manual-1"] })).toBe("SUPPORTED");
  });

  it("rejects only from an applicable independent deterministic verifier experiment", () => {
    const rejecting = { ...verifier, outcome: "rejecting" as const };
    expect(assess([rejecting])).toBe("REJECTED");
    expect(assess([{ ...rejecting, deterministic: false }])).toBe("SUPPORTED");
    expect(assess([{ ...rejecting, producer: { actorId: "analyst-a", role: "verifier" as const } }])).toBe("SUPPORTED");
    expect(assess([{ ...rejecting, testedPredictions: ["unrelated"] }])).toBe("SUPPORTED");
  });

  it("reports duplicate IDs and remains deterministic under permutation", () => {
    const duplicate = { ...assertion, claim: "alternate" };
    const input = { assertions: [assertion, duplicate], evidence: [evidence[0]!, evidence[0]!, evidence[1]!], experiments: [verifier, verifier] };
    const forward = evaluateEvidenceLifecycle(input);
    const reverse = evaluateEvidenceLifecycle({ assertions: [...input.assertions].reverse(), evidence: [...input.evidence].reverse(), experiments: [...input.experiments].reverse() });
    expect(reverse).toEqual(forward);
    expect(forward.decision).toBe("block");
    expect(forward.reasons.map(({ code }) => code)).toEqual(["DUPLICATE_ASSERTION_ID", "DUPLICATE_EVIDENCE_ID", "DUPLICATE_EXPERIMENT_ID"]);
  });

  it("rejects empty experiments and internally contradictory gate decisions", () => {
    expect(lifecycleExperimentSchema.safeParse({ ...verifier, testedPredictions: [] }).success).toBe(false);
    expect(lifecycleExperimentSchema.safeParse({ ...verifier, evidenceIds: [] }).success).toBe(false);
    expect(() => evaluateEvidenceLifecycle({
      assertions: [assertion], evidence,
      experiments: [{ ...verifier, evidenceIds: [] }],
    })).toThrow();
    expect(generationGateDecisionSchema.safeParse({
      decision: "allow", faithfulGeneration: false,
      assertionIds: ["movement"], assessments: [], reasons: [],
    }).success).toBe(false);
    expect(generationGateDecisionSchema.safeParse({
      decision: "allow", faithfulGeneration: true,
      assertionIds: ["movement"],
      assessments: [{ assertionId: "movement", status: "HYPOTHESIS", channels: ["static-analysis"], reasons: [] }],
      reasons: [],
    }).success).toBe(false);
    expect(generationGateDecisionSchema.safeParse({
      decision: "allow", faithfulGeneration: true,
      assertionIds: ["different"],
      assessments: [{ assertionId: "movement", status: "SUPPORTED", channels: ["static-analysis", "dynamic-trace"], reasons: [] }],
      reasons: [],
    }).success).toBe(false);
  });
});
