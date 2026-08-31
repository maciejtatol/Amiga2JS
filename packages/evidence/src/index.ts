import {
  evidenceLifecycleInputSchema,
  type AgentResult,
  type GenerationGateDecision,
  type LifecycleEvidenceRecord,
  type LifecycleExperiment,
  type LifecycleReason,
  type SemanticAssertion,
  type SemanticLifecycleStatus,
} from "@retroport/schemas";

export interface EvidenceLifecycleInput {
  assertions: readonly SemanticAssertion[];
  evidence: readonly LifecycleEvidenceRecord[];
  experiments: readonly LifecycleExperiment[];
}

const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
const reasonCompare = (left: LifecycleReason, right: LifecycleReason): number =>
  compare(`${left.code}:${left.referenceId}:${left.message}`, `${right.code}:${right.referenceId}:${right.message}`);

function duplicateReasons(
  ids: readonly string[],
  code: "DUPLICATE_ASSERTION_ID" | "DUPLICATE_EVIDENCE_ID" | "DUPLICATE_EXPERIMENT_ID",
): LifecycleReason[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) seen.has(id) ? duplicates.add(id) : seen.add(id);
  return [...duplicates].sort(compare).map((id) => ({ code, referenceId: id, message: `Duplicate id: ${id}` }));
}

export function evaluateEvidenceLifecycle(input: EvidenceLifecycleInput): GenerationGateDecision {
  input = evidenceLifecycleInputSchema.parse(input);
  const globalReasons = [
    ...duplicateReasons(input.assertions.map(({ id }) => id), "DUPLICATE_ASSERTION_ID"),
    ...duplicateReasons(input.evidence.map(({ id }) => id), "DUPLICATE_EVIDENCE_ID"),
    ...duplicateReasons(input.experiments.map(({ id }) => id), "DUPLICATE_EXPERIMENT_ID"),
  ];
  const canonical = <T extends { id: string }>(items: readonly T[]): T[] => {
    const groups = new Map<string, T[]>();
    for (const item of items) groups.set(item.id, [...(groups.get(item.id) ?? []), item]);
    return [...groups.entries()].sort(([left], [right]) => compare(left, right)).map(([, group]) =>
      group.sort((left, right) => compare(JSON.stringify(left), JSON.stringify(right)))[0]!,
    );
  };
  const canonicalEvidence = canonical(input.evidence);
  const canonicalExperiments = canonical(input.experiments);
  const evidenceById = new Map(canonicalEvidence.map((item) => [item.id, item]));
  const assertionIds = new Set(input.assertions.map(({ id }) => id));

  for (const experiment of canonicalExperiments) {
    if (!assertionIds.has(experiment.assertionId)) globalReasons.push({
      code: "MISSING_ASSERTION", referenceId: experiment.assertionId,
      message: `Experiment ${experiment.id} references missing assertion ${experiment.assertionId}`,
    });
    for (const evidenceId of experiment.evidenceIds) {
      if (!evidenceById.has(evidenceId)) globalReasons.push({
        code: "MISSING_EVIDENCE", referenceId: evidenceId,
        message: `Experiment ${experiment.id} references missing evidence ${evidenceId}`,
      });
    }
  }

  const uniqueAssertions = canonical(input.assertions);
  const assessments = uniqueAssertions.map((assertion) => {
    const reasons: LifecycleReason[] = [];
    const records = assertion.evidenceIds.map((id) => {
      const record = evidenceById.get(id);
      if (!record) reasons.push({ code: "MISSING_EVIDENCE", referenceId: id, message: `Assertion ${assertion.id} references missing evidence ${id}` });
      return record;
    }).filter((item): item is LifecycleEvidenceRecord => item !== undefined);
    if (assertion.predictions.length === 0) reasons.push({ code: "MISSING_PREDICTIONS", referenceId: assertion.id, message: `Assertion ${assertion.id} has no falsifiable predictions` });
    const experiments = canonicalExperiments.filter((item) => item.assertionId === assertion.id);
    const qualifies = (experiment: LifecycleExperiment): boolean =>
      experiment.status === "passed"
      && experiment.deterministic
      && experiment.producer.role === "verifier"
      && experiment.producer.actorId !== assertion.analystId
      && experiment.evidenceIds.length > 0
      && experiment.evidenceIds.every((id) => evidenceById.has(id))
      && assertion.predictions.every((prediction) => experiment.testedPredictions.includes(prediction));
    const rejected = experiments.some((item) => item.outcome === "rejecting" && qualifies(item));
    const verified = experiments.some((item) => item.outcome === "supporting" && qualifies(item));
    const channels = [...new Set(records.map(({ channel }) => channel))].sort(compare);
    let status: SemanticLifecycleStatus = "UNKNOWN";
    if (rejected) status = "REJECTED";
    else if (records.length > 0 && reasons.every(({ code }) => code !== "MISSING_EVIDENCE")) {
      status = "CANDIDATE";
      if (assertion.predictions.length > 0) {
        status = "HYPOTHESIS";
        if (channels.length < 2) reasons.push({ code: "INSUFFICIENT_CHANNELS", referenceId: assertion.id, message: `Assertion ${assertion.id} requires evidence from at least two channels` });
        if (channels.length >= 2) status = verified ? "VERIFIED" : "SUPPORTED";
      }
    }
    return { assertionId: assertion.id, status, channels, reasons: reasons.sort(reasonCompare) };
  });
  const allReasons = [...globalReasons, ...assessments.flatMap(({ reasons }) => reasons)];
  const reasons = [...new Map(allReasons.map((reason) => [
    `${reason.code}:${reason.referenceId}:${reason.message}`,
    reason,
  ])).values()].sort(reasonCompare);
  const faithfulGeneration = assessments.length > 0 && globalReasons.length === 0
    && assessments.every(({ status }) => status === "SUPPORTED" || status === "VERIFIED");
  const common = { assertionIds: assessments.map(({ assertionId }) => assertionId), assessments, reasons };
  return faithfulGeneration
    ? { ...common, decision: "allow", faithfulGeneration: true }
    : { ...common, decision: "block", faithfulGeneration: false };
}

export function generationGateAgentResult(input: EvidenceLifecycleInput): AgentResult<GenerationGateDecision> {
  const output = evaluateEvidenceLifecycle(input);
  return {
    status: output.decision === "allow" ? "success" : "blocked",
    output,
    evidence: [...new Set(input.evidence.map(({ id }) => id))].sort(compare),
    assumptions: [], warnings: [], confidence: output.decision === "allow" ? 1 : 0,
    nextActions: output.decision === "allow" ? [] : [{ description: "Resolve evidence gate reasons before faithful generation", priority: "high" }],
  };
}
