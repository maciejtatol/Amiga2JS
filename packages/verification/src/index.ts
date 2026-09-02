import {
  findFirstObservationMismatch,
  runtimeObservationSchema,
  type RuntimeObservation,
} from "@retroport/runtime-amiberry";
import {
  horizontalMovementIRSchema,
  type HorizontalMovementIR,
} from "@retroport/schemas";
import {
  simulateScenario,
  simulationInputSchema,
  simulationStateSchema,
  type SimulationInput,
  type SimulationState,
} from "@retroport/target-typescript";

export interface VerificationReport {
  readonly passed: boolean;
  readonly expected: readonly RuntimeObservation[];
  readonly mismatch: ReturnType<typeof findFirstObservationMismatch>;
}

export interface AcceptanceScenario {
  readonly id: string;
  readonly inputs: readonly SimulationInput[];
}

export interface AcceptanceSuiteReport {
  readonly passed: boolean;
  readonly scenarios: readonly {
    readonly id: string;
    readonly ticks: number;
    readonly verification: VerificationReport;
  }[];
}

const referenceVelocity = (input: SimulationInput): number => {
  if (input === "LEFT") return -2;
  if (input === "RIGHT") return 2;
  return 0;
};

function referenceObservations(
  scenario: AcceptanceScenario,
  initialState: SimulationState,
): readonly RuntimeObservation[] {
  // Keep this model intentionally separate from target-typescript. The suite
  // must catch a bug shared by the generated simulator and its test harness.
  let state = simulationStateSchema.parse(structuredClone(initialState));
  return scenario.inputs.map((input, tick) => {
    const velocityX = referenceVelocity(input);
    state = simulationStateSchema.parse({
      playerX: ((state.playerX + velocityX + 0x8000) & 0xffff) - 0x8000,
      velocityX,
      tickCounter: (state.tickCounter + 1) >>> 0,
    });
    return runtimeObservationSchema.parse({
      scenarioId: scenario.id,
      tick,
      input,
      state: structuredClone(state),
    });
  });
}

function expectedObservations(
  scenarioId: string,
  initialState: SimulationState,
  inputs: readonly SimulationInput[],
  ir: HorizontalMovementIR,
): readonly RuntimeObservation[] {
  const states = simulateScenario(initialState, inputs, ir);
  return states.map((state, tick) => runtimeObservationSchema.parse({
    scenarioId,
    tick,
    input: inputs[tick],
    state,
  }));
}

export function verifyScenario(
  scenarioIdInput: string,
  initialStateInput: SimulationState,
  inputsInput: readonly SimulationInput[],
  irInput: HorizontalMovementIR,
  actualInput: readonly RuntimeObservation[],
): VerificationReport {
  const scenarioId = scenarioIdInput;
  const initialState = simulationStateSchema.parse(structuredClone(initialStateInput));
  const inputs = simulationInputSchema.array().parse(structuredClone(inputsInput));
  const ir = horizontalMovementIRSchema.parse(structuredClone(irInput));
  const actual = runtimeObservationSchema.array().parse(structuredClone(actualInput));
  if (actual.some((observation) => observation.scenarioId !== scenarioId)) {
    throw new Error(`Observation scenario does not match: ${scenarioId}`);
  }
  const expected = expectedObservations(scenarioId, initialState, inputs, ir);
  for (const observation of actual) {
    const expectedObservation = expected.find(({ tick }) => tick === observation.tick);
    if (expectedObservation && expectedObservation.input !== observation.input) {
      throw new Error(`Observation input does not match at tick ${observation.tick}`);
    }
  }
  const mismatch = findFirstObservationMismatch(expected, actual);
  return { passed: mismatch === null, expected, mismatch };
}

export function runPhase0AcceptanceSuite(irInput: HorizontalMovementIR): AcceptanceSuiteReport {
  const ir = horizontalMovementIRSchema.parse(structuredClone(irInput));
  const inputs = ["LEFT", "RIGHT", "NONE"] as const;
  const scenarios = inputs.map((input) => ({
    id: `constant-${input.toLowerCase()}`,
    inputs: Array.from({ length: 1000 }, () => input),
  }));
  const initialState = { playerX: 0, velocityX: 0, tickCounter: 0 };
  const results = scenarios.map((scenario) => {
    const actual = referenceObservations(scenario, initialState);
    const verification = verifyScenario(scenario.id, initialState, scenario.inputs, ir, actual);
    return { id: scenario.id, ticks: scenario.inputs.length, verification };
  });
  return { passed: results.every(({ verification }) => verification.passed), scenarios: results };
}
