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
import type { AgentResult, HorizontalMovementIR } from "@retroport/schemas";
import type { StaticAnalysisSnapshot } from "@retroport/static-analysis";
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

export interface Phase0Scenario {
  readonly id: string;
  readonly inputs: readonly RuntimeInput[];
}

export type FixtureStep = (
  state: Readonly<Record<string, number>>,
  input: RuntimeInput,
) => Readonly<Record<string, number>>;

export interface Phase0PipelineInput {
  readonly scenarios: readonly Phase0Scenario[];
  readonly initialState: SimulationState;
  readonly step: FixtureStep;
  readonly metadata: MovementIRMetadata;
  readonly groundTruth: MovementGroundTruth;
  readonly staticSnapshot?: StaticAnalysisSnapshot;
}

export interface Phase0PipelineResult {
  readonly observations: readonly RuntimeObservation[];
  readonly analysis: AgentResult<MovementDiscovery>;
  readonly review: AgentResult<MovementReview>;
  readonly ir: HorizontalMovementIR | null;
  readonly generatedSource: string | null;
  readonly verification: readonly VerificationReport[];
  readonly grade: AgentResult<MovementGrade> | null;
  readonly passed: boolean;
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
  const metadata = movementIRMetadataSchema.parse(structuredClone(input.metadata));
  const groundTruth = movementGroundTruthSchema.parse(structuredClone(input.groundTruth));
  const observations = collectObservations(input.scenarios, input.initialState, input.step);
  const analysis = analyzeHorizontalMovement(observations, input.staticSnapshot);
  const review = reviewHorizontalMovement(analysis.output.selected, observations);
  if (analysis.status !== "success" || review.status !== "success" || !analysis.output.selected) {
    return { observations, analysis, review, ir: null, generatedSource: null, verification: [], grade: null, passed: false };
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
