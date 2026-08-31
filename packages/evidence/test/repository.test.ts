import { describe, expect, it } from "vitest";
import { EvidenceConflictError, InMemoryEvidenceRepository } from "../src/index.js";

describe("evidence repository", () => {
  it("accepts out-of-order references, sorts snapshots and detaches values", async () => {
    const repo = new InMemoryEvidenceRepository();
    await repo.putExperiment({ id: "x", assertionId: "a", producer: { actorId: "v", role: "verifier" }, status: "passed", outcome: "supporting", deterministic: true, testedPredictions: ["p"], evidenceIds: ["e"] });
    await repo.putEvidence({ id: "e", channel: "dynamic-trace", producer: { actorId: "t", role: "tool" }, summary: "trace" });
    const assertion = { id: "a", claim: "claim", analystId: "analyst", evidenceIds: ["e"], predictions: ["p"] };
    await repo.putAssertion(assertion);
    await repo.putAssertion({ ...assertion, id: "B" });
    await repo.putAssertion(structuredClone(assertion));
    const first = await repo.snapshot();
    (first.assertions[0] as { claim: string }).claim = "tampered";
    expect((await repo.snapshot()).assertions[0]?.claim).toBe("claim");
    await repo.putEvidence({ id: "A", channel: "static-analysis", producer: { actorId: "t", role: "tool" }, summary: "static" });
    await repo.putExperiment({ id: "A", assertionId: "a", producer: { actorId: "v", role: "verifier" }, status: "passed", outcome: "supporting", deterministic: true, testedPredictions: ["p"], evidenceIds: ["e"] });
    const sorted = await repo.snapshot();
    expect(sorted.assertions.map(({ id }) => id)).toEqual(["B", "a"]);
    expect(sorted.evidence.map(({ id }) => id)).toEqual(["A", "e"]);
    expect(sorted.experiments.map(({ id }) => id)).toEqual(["A", "x"]);
  });

  it("rejects conflicting values with the same ID", async () => {
    const repo = new InMemoryEvidenceRepository();
    await repo.putEvidence({ id: "e", channel: "dynamic-trace", producer: { actorId: "t", role: "tool" }, summary: "one" });
    await expect(repo.putEvidence({ id: "e", channel: "dynamic-trace", producer: { actorId: "t", role: "tool" }, summary: "two" })).rejects.toBeInstanceOf(EvidenceConflictError);
    await repo.putAssertion({ id: "a", claim: "one", analystId: "x", evidenceIds: [], predictions: [] });
    await expect(repo.putAssertion({ id: "a", claim: "two", analystId: "x", evidenceIds: [], predictions: [] })).rejects.toBeInstanceOf(EvidenceConflictError);
    const experiment = { id: "x", assertionId: "a", producer: { actorId: "v", role: "verifier" as const }, status: "passed" as const, outcome: "supporting" as const, deterministic: true, testedPredictions: ["p"], evidenceIds: ["e"] };
    await repo.putExperiment(experiment);
    await expect(repo.putExperiment({ ...experiment, deterministic: false })).rejects.toBeInstanceOf(EvidenceConflictError);
  });
});
