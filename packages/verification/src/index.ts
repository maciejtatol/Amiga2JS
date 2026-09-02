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
