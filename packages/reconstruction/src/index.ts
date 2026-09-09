import {
  runtimeObservationSchema,
  type RuntimeInput,
  type RuntimeObservation,
} from "@retroport/runtime-amiberry";
import {
  agentResultSchema,
  horizontalMovementIRSchema,
  type AgentResult,
  type HorizontalMovementIR,
} from "@retroport/schemas";
import {
  staticAnalysisSnapshotSchema,
  type StaticAnalysisSnapshot,
} from "@retroport/static-analysis";
import { z } from "zod";

const inputMappingSchema = z.object({
  left: z.number().int(),
  idle: z.number().int(),
  right: z.number().int(),
}).strict();

export const movementCandidateSchema = z.object({
  field: z.string().min(1),
  inputMapping: inputMappingSchema,
  writerAddresses: z.array(z.string().min(1)),
  evidenceIds: z.array(z.string().min(1)).min(1),
}).strict();
export type MovementCandidate = z.infer<typeof movementCandidateSchema>;

export const movementGroundTruthSchema = z.object({
  field: z.string().min(1),
  inputMapping: inputMappingSchema,
  writerAddresses: z.array(z.string().min(1)),
}).strict();
export type MovementGroundTruth = z.infer<typeof movementGroundTruthSchema>;

export const movementGradeSchema = z.object({
  passed: z.boolean(),
  fieldMatch: z.boolean(),
  inputMappingMatch: z.boolean(),
  writerAddressesMatch: z.boolean(),
  concerns: z.array(z.string().min(1)),
}).strict();
export type MovementGrade = z.infer<typeof movementGradeSchema>;

export const movementDiscoverySchema = z.object({
  candidates: z.array(movementCandidateSchema),
  selected: movementCandidateSchema.nullable(),
}).strict();
export type MovementDiscovery = z.infer<typeof movementDiscoverySchema>;

export const movementReviewSchema = z.object({
  approved: z.boolean(),
  candidateField: z.string().min(1).nullable(),
  checkedScenarios: z.array(z.string().min(1)),
  concerns: z.array(z.string().min(1)),
}).strict();
export type MovementReview = z.infer<typeof movementReviewSchema>;

// These fields describe the execution model that runtime deltas cannot prove
// on their own. Keeping them explicit prevents the bridge from inventing a
// tick rate, numeric width, or update order during generation.
export const movementIRMetadataSchema = z.object({
  tick: z.object({ unit: z.literal("frame"), rateHz: z.number().positive() }).strict(),
  position: z.object({ bits: z.literal(16), signed: z.literal(true) }).strict(),
  velocity: z.object({ bits: z.literal(16), signed: z.literal(true) }).strict(),
  updateOrder: z.tuple([
    z.literal("read-input"), z.literal("set-velocity"), z.literal("apply-velocity"),
  ]),
}).strict();
export type MovementIRMetadata = z.infer<typeof movementIRMetadataSchema>;

/** Convert an approved candidate into IR only after its execution metadata is supplied. */
export function movementCandidateToIR(
  candidateInput: MovementCandidate,
  metadataInput: MovementIRMetadata,
): HorizontalMovementIR {
  const candidate = movementCandidateSchema.parse(structuredClone(candidateInput));
  const metadata = movementIRMetadataSchema.parse(structuredClone(metadataInput));
  return horizontalMovementIRSchema.parse({
    ...metadata,
    inputMapping: candidate.inputMapping,
  });
}

/** Grade a candidate against separately held source ground truth. */
export function gradeHorizontalMovement(
  candidateInput: MovementCandidate,
  groundTruthInput: MovementGroundTruth,
): AgentResult<MovementGrade> {
  const candidate = movementCandidateSchema.parse(structuredClone(candidateInput));
  const groundTruth = movementGroundTruthSchema.parse(structuredClone(groundTruthInput));
  const fieldMatch = candidate.field === groundTruth.field;
  const inputMappingMatch = candidate.inputMapping.left === groundTruth.inputMapping.left
    && candidate.inputMapping.idle === groundTruth.inputMapping.idle
    && candidate.inputMapping.right === groundTruth.inputMapping.right;
  const candidateWriters = [...candidate.writerAddresses].sort(compare);
  const groundTruthWriters = [...groundTruth.writerAddresses].sort(compare);
  const writerAddressesMatch = candidateWriters.length === groundTruthWriters.length
    && candidateWriters.every((address, index) => address === groundTruthWriters[index]);
  const concerns = [
    ...(fieldMatch ? [] : [`Expected field ${groundTruth.field}, got ${candidate.field}`]),
    ...(inputMappingMatch ? [] : ["Candidate input mapping differs from ground truth"]),
    ...(writerAddressesMatch ? [] : ["Candidate writer addresses differ from ground truth"]),
  ];
  const output = movementGradeSchema.parse({
    passed: concerns.length === 0,
    fieldMatch,
    inputMappingMatch,
    writerAddressesMatch,
    concerns,
  });
  const matchedDimensions = [fieldMatch, inputMappingMatch, writerAddressesMatch].filter(Boolean).length;
  return agentResultSchema(movementGradeSchema).parse({
    status: output.passed ? "success" : "blocked",
    output,
    evidence: candidate.evidenceIds,
    assumptions: [],
    warnings: output.concerns.map((message) => ({ code: "reconstruction.ground-truth-mismatch", message })),
    confidence: matchedDimensions / 3,
    nextActions: output.passed ? [] : [{
      description: "Review the candidate evidence and repeat reconstruction after resolving mismatches",
      priority: "high",
    }],
  });
}

interface DeltaSamples {
  readonly LEFT: number[];
  readonly NONE: number[];
  readonly RIGHT: number[];
}

const emptySamples = (): DeltaSamples => ({ LEFT: [], NONE: [], RIGHT: [] });
const compare = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;
const allEqual = (values: readonly number[]): boolean =>
  values.length > 0 && values.every((value) => value === values[0]);
const mappingValue = (
  input: RuntimeInput,
  mapping: MovementCandidate["inputMapping"],
): number => {
  if (input === "LEFT") return mapping.left;
  if (input === "RIGHT") return mapping.right;
  return mapping.idle;
};

function observationsByScenario(
  observations: readonly RuntimeObservation[],
): Map<string, RuntimeObservation[]> {
  const grouped = new Map<string, RuntimeObservation[]>();
  for (const observation of observations) {
    grouped.set(observation.scenarioId, [
      ...(grouped.get(observation.scenarioId) ?? []),
      observation,
    ]);
  }
  for (const values of grouped.values()) {
    values.sort((left, right) => left.tick - right.tick);
  }
  return grouped;
}

function collectDeltas(
  observations: readonly RuntimeObservation[],
  field: string,
): DeltaSamples {
  const samples = emptySamples();
  for (const scenario of observationsByScenario(observations).values()) {
    for (let index = 1; index < scenario.length; index += 1) {
      const previous = scenario[index - 1]!;
      const current = scenario[index]!;
      // A gap means we cannot attribute the change to one simulation tick.
      if (current.tick !== previous.tick + 1) continue;
      const previousValue = previous.state[field];
      const currentValue = current.state[field];
      if (previousValue === undefined || currentValue === undefined) continue;
      samples[current.input].push(currentValue - previousValue);
    }
  }
  return samples;
}

function supportingEvidenceIds(
  observations: readonly RuntimeObservation[],
  field: string,
): string[] {
  const selected = new Map<RuntimeInput, string>();
  for (const scenario of observationsByScenario(observations).values()) {
    for (let index = 1; index < scenario.length; index += 1) {
      const previous = scenario[index - 1]!;
      const current = scenario[index]!;
      if (current.tick !== previous.tick + 1) continue;
      if (previous.state[field] === undefined || current.state[field] === undefined) continue;
      selected.set(
        current.input,
        selected.get(current.input) ?? `runtime-observation:${current.scenarioId}:${current.tick}`,
      );
    }
  }
  return [...selected.values()].sort(compare);
}

function candidateForField(
  field: string,
  observations: readonly RuntimeObservation[],
  staticSnapshot?: StaticAnalysisSnapshot,
): MovementCandidate | null {
  const samples = collectDeltas(observations, field);
  if (!(allEqual(samples.LEFT) && allEqual(samples.NONE) && allEqual(samples.RIGHT))) {
    return null;
  }
  const left = samples.LEFT[0]!;
  const idle = samples.NONE[0]!;
  const right = samples.RIGHT[0]!;
  if (left >= 0 || idle !== 0 || right <= 0 || Math.abs(left) !== right) return null;

  const writerAddresses = staticSnapshot
    ? staticSnapshot.functions
      .filter((func) => func.writes.some(({ address }) => address === field))
      .map(({ address }) => address)
      .sort(compare)
    : [];
  return movementCandidateSchema.parse({
    field,
    inputMapping: { left, idle, right },
    writerAddresses,
    evidenceIds: supportingEvidenceIds(observations, field),
  });
}

/** Infer the smallest horizontal movement claim supported by all input channels. */
export function analyzeHorizontalMovement(
  observationsInput: readonly RuntimeObservation[],
  staticSnapshotInput?: StaticAnalysisSnapshot,
): AgentResult<MovementDiscovery> {
  const observations = runtimeObservationSchema.array().parse(structuredClone(observationsInput));
  const staticSnapshot = staticSnapshotInput === undefined
    ? undefined
    : staticAnalysisSnapshotSchema.parse(structuredClone(staticSnapshotInput));
  const scenarios = observationsByScenario(observations);
  const fields = [...new Set(observations.flatMap(({ state }) => Object.keys(state)))].sort(compare);
  const candidates = scenarios.size < 3
    ? []
    : fields
      .map((field) => candidateForField(field, observations, staticSnapshot))
      .filter((candidate): candidate is MovementCandidate => candidate !== null);
  const selected = candidates.length === 1 ? candidates[0]! : null;
  const output = movementDiscoverySchema.parse({ candidates, selected });
  return agentResultSchema(movementDiscoverySchema).parse({
    status: selected ? "success" : "blocked",
    output,
    evidence: selected?.evidenceIds ?? [],
    assumptions: [],
    warnings: selected ? [] : [{
      code: "reconstruction.no-unique-horizontal-candidate",
      message: "Runtime deltas did not identify exactly one horizontal movement field",
    }],
    confidence: selected ? 1 : 0,
    nextActions: selected ? [] : [{
      description: "Capture contiguous LEFT, RIGHT, and NONE observations for the candidate state fields",
      priority: "high",
    }],
  });
}

/** Independently replay the observed deltas to challenge an analyst's candidate. */
export function reviewHorizontalMovement(
  candidateInput: MovementCandidate | null,
  observationsInput: readonly RuntimeObservation[],
): AgentResult<MovementReview> {
  const observations = runtimeObservationSchema.array().parse(structuredClone(observationsInput));
  const candidate = candidateInput === null ? null : movementCandidateSchema.parse(structuredClone(candidateInput));
  const grouped = observationsByScenario(observations);
  const concerns: string[] = [];
  if (!candidate) concerns.push("The analyst did not produce a unique candidate");
  if (grouped.size < 3) concerns.push("Independent review requires LEFT, RIGHT, and NONE scenarios");

  if (candidate) {
    for (const scenario of grouped.values()) {
      for (let index = 1; index < scenario.length; index += 1) {
        const previous = scenario[index - 1]!;
        const current = scenario[index]!;
        if (current.tick !== previous.tick + 1) continue;
        const previousValue = previous.state[candidate.field];
        const currentValue = current.state[candidate.field];
        if (previousValue === undefined || currentValue === undefined) {
          concerns.push(`Missing ${candidate.field} at ${current.scenarioId}:${current.tick}`);
          continue;
        }
        const expected = mappingValue(current.input, candidate.inputMapping);
        if (currentValue - previousValue !== expected) {
          concerns.push(`Unexpected ${candidate.field} delta at ${current.scenarioId}:${current.tick}`);
        }
      }
    }
  }

  const output = movementReviewSchema.parse({
    approved: concerns.length === 0,
    candidateField: candidate?.field ?? null,
    checkedScenarios: [...grouped.keys()].sort(compare),
    concerns: [...new Set(concerns)].sort(compare),
  });
  return agentResultSchema(movementReviewSchema).parse({
    status: output.approved ? "success" : "blocked",
    output,
    evidence: candidate?.evidenceIds ?? [],
    assumptions: [],
    warnings: output.concerns.map((message) => ({ code: "reconstruction.review-concern", message })),
    confidence: output.approved ? 1 : 0,
    nextActions: output.approved ? [] : [{
      description: "Resolve reviewer concerns and repeat the controlled capture",
      priority: "high",
    }],
  });
}

export type { RuntimeInput };
