import { createHash } from "node:crypto";
import {
  analyzeHorizontalMovement,
  gradeHorizontalMovement,
  movementCandidateToIR,
  movementGroundTruthSchema,
  movementIRMetadataSchema,
  type MovementGroundTruth,
  type MovementIRMetadata,
  type MovementDiscovery,
  type MovementGrade,
  type MovementReview,
  reviewHorizontalMovement,
} from "@retroport/reconstruction";
import {
  runtimeInputSchema,
  runtimeObservationSchema,
  type RuntimeInput,
  type RuntimeObservation,
} from "@retroport/runtime-amiberry";
import { runHorizontalMovement } from "@retroport/source-amiga-hunk";
import type { AgentResult, HorizontalMovementIR } from "@retroport/schemas";
import { normalizeSnapshot, type StaticAnalysisSnapshot } from "@retroport/static-analysis";
import {
  generateSimulationSource,
  simulationStateSchema,
  type SimulationState,
} from "@retroport/target-typescript";
import {
  verifyScenario,
  type VerificationReport,
} from "@retroport/verification";
import { z } from "zod";

const scenarioSchema = z.object({
  id: z.string().min(1),
  inputs: z.array(runtimeInputSchema),
}).strict();
const scenariosSchema = z.array(scenarioSchema).superRefine((scenarios, context) => {
  const seen = new Set<string>();
  for (const [index, scenario] of scenarios.entries()) {
    if (seen.has(scenario.id)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: [index, "id"], message: "Scenario IDs must be unique" });
    }
    seen.add(scenario.id);
  }
});
const digestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);

export const phase0RunManifestSchema = z.object({
  schemaVersion: z.literal(1),
  artifactId: digestSchema,
  staticSnapshotDigest: digestSchema.nullable(),
  observationDigest: digestSchema,
  analysisDigest: digestSchema,
  reviewDigest: digestSchema,
  irDigest: digestSchema.nullable(),
  generatedSourceDigest: digestSchema.nullable(),
  verificationDigest: digestSchema.nullable(),
  gradeDigest: digestSchema.nullable(),
}).strict();
export type Phase0RunManifest = z.infer<typeof phase0RunManifestSchema>;

export interface Phase0Scenario {
  readonly id: string;
  readonly inputs: readonly RuntimeInput[];
}

export type FixtureStep = (
  state: Readonly<Record<string, number>>,
  input: RuntimeInput,
) => Readonly<Record<string, number>>;

export interface Phase0PipelineInput {
  readonly artifactId: string;
  readonly scenarios: readonly Phase0Scenario[];
  readonly initialState: SimulationState;
  readonly step: FixtureStep;
  readonly metadata: MovementIRMetadata;
  readonly groundTruth: MovementGroundTruth;
  readonly staticSnapshot?: StaticAnalysisSnapshot;
}

export interface Phase0PipelineResult {
  readonly manifest: Phase0RunManifest;
  readonly observations: readonly RuntimeObservation[];
  readonly analysis: AgentResult<MovementDiscovery>;
  readonly review: AgentResult<MovementReview>;
  readonly ir: HorizontalMovementIR | null;
  readonly generatedSource: string | null;
  readonly verification: readonly VerificationReport[];
  readonly grade: AgentResult<MovementGrade> | null;
  readonly passed: boolean;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, nested]) => [key, canonicalize(nested)]));
  }
  return value;
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex")}`;
}

const microFixtureScenarios: readonly Phase0Scenario[] = [
  { id: "constant-left", inputs: ["LEFT", "LEFT", "NONE"] },
  { id: "constant-right", inputs: ["RIGHT", "RIGHT", "NONE"] },
  { id: "constant-none", inputs: ["NONE", "NONE"] },
];

const microFixtureMetadata: MovementIRMetadata = {
  tick: { unit: "frame", rateHz: 50 },
  position: { bits: 16, signed: true },
  velocity: { bits: 16, signed: true },
  updateOrder: ["read-input", "set-velocity", "apply-velocity"],
};

function requiredStateValue(state: Readonly<Record<string, number>>, field: string): number {
  const value = state[field];
  if (value === undefined) throw new Error(`MicroFixture state is missing ${field}`);
  return value;
}

const microFixtureStep: FixtureStep = (state, input) => ({
  ...runHorizontalMovement({
    name: "amiga-m68k-horizontal",
    playerX: requiredStateValue(state, "playerX"),
    velocityX: requiredStateValue(state, "velocityX"),
    inputState: input,
    tickCounter: requiredStateValue(state, "tickCounter"),
  }),
});

/** Run the repository-owned fixture with its known verification metadata. */
export function runMicroFixturePipeline(): Phase0PipelineResult {
  return runPhase0Pipeline({
    artifactId: "sha256:2aee47bd7b094ba96d51dbdb71588f52e8b31fe84f21d544aeadd2d01c7b59f5",
    scenarios: microFixtureScenarios,
    initialState: { playerX: 0, velocityX: 0, tickCounter: 0 },
    step: microFixtureStep,
    metadata: microFixtureMetadata,
    groundTruth: {
      field: "playerX",
      inputMapping: { left: -2, idle: 0, right: 2 },
      writerAddresses: [],
    },
  });
}

function collectObservations(
  scenariosInput: readonly Phase0Scenario[],
  initialStateInput: SimulationState,
  step: FixtureStep,
): readonly RuntimeObservation[] {
  const scenarios = scenariosSchema.parse(structuredClone(scenariosInput));
  const initialState = simulationStateSchema.parse(structuredClone(initialStateInput));
  return scenarios.flatMap((scenario) => {
    let state: Readonly<Record<string, number>> = { ...initialState };
    return scenario.inputs.map((input, tick) => {
      state = simulationStateSchema.parse(structuredClone(step(state, input)));
      return runtimeObservationSchema.parse({
        scenarioId: scenario.id,
        tick,
        input,
        state: structuredClone(state),
      });
    });
  });
}

/** Run every local Phase 0 boundary without requiring external services. */
export function runPhase0Pipeline(input: Phase0PipelineInput): Phase0PipelineResult {
  const artifactId = digestSchema.parse(input.artifactId);
  const metadata = movementIRMetadataSchema.parse(structuredClone(input.metadata));
  const groundTruth = movementGroundTruthSchema.parse(structuredClone(input.groundTruth));
  const observations = collectObservations(input.scenarios, input.initialState, input.step);
  const analysis = analyzeHorizontalMovement(observations, input.staticSnapshot);
  const review = reviewHorizontalMovement(analysis.output.selected, observations);
  const staticSnapshotDigest = input.staticSnapshot === undefined
    ? null
    : digest(normalizeSnapshot(input.staticSnapshot));
  if (analysis.status !== "success" || review.status !== "success" || !analysis.output.selected) {
    return {
      manifest: phase0RunManifestSchema.parse({
        schemaVersion: 1, artifactId, staticSnapshotDigest,
        observationDigest: digest(observations), analysisDigest: digest(analysis), reviewDigest: digest(review),
        irDigest: null, generatedSourceDigest: null, verificationDigest: null, gradeDigest: null,
      }),
      observations, analysis, review, ir: null, generatedSource: null, verification: [], grade: null, passed: false,
    };
  }

  const ir = movementCandidateToIR(analysis.output.selected, metadata);
  const generatedSource = generateSimulationSource(ir);
  const scenarios = scenariosSchema.parse(structuredClone(input.scenarios));
  const verification = scenarios.map((scenario) => verifyScenario(
    scenario.id,
    input.initialState,
    scenario.inputs,
    ir,
    observations.filter(({ scenarioId }) => scenarioId === scenario.id),
  ));
  const grade = gradeHorizontalMovement(analysis.output.selected, groundTruth);
  return {
    manifest: phase0RunManifestSchema.parse({
      schemaVersion: 1, artifactId, staticSnapshotDigest,
      observationDigest: digest(observations), analysisDigest: digest(analysis), reviewDigest: digest(review),
      irDigest: digest(ir), generatedSourceDigest: digest(generatedSource),
      verificationDigest: digest(verification), gradeDigest: digest(grade),
    }),
    observations,
    analysis,
    review,
    ir,
    generatedSource,
    verification,
    grade,
    passed: grade.status === "success" && verification.every(({ passed }) => passed),
  };
}
