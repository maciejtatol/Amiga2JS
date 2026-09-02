import { horizontalMovementIRSchema, type HorizontalMovementIR } from "@retroport/schemas";
import { z } from "zod";

export const simulationInputSchema = z.enum(["LEFT", "RIGHT", "NONE"]);
export type SimulationInput = z.infer<typeof simulationInputSchema>;
export const simulationStateSchema = z.object({
  playerX: z.number().int(), velocityX: z.number().int(), tickCounter: z.number().int().nonnegative(),
}).strict();
export type SimulationState = z.infer<typeof simulationStateSchema>;

const signed16 = (value: number): number => ((value + 0x8000) & 0xffff) - 0x8000;
const unsigned32 = (value: number): number => value >>> 0;

function velocityFor(input: SimulationInput, ir: HorizontalMovementIR): number {
  if (input === "LEFT") return ir.inputMapping.left;
  if (input === "RIGHT") return ir.inputMapping.right;
  return ir.inputMapping.idle;
}

export function stepSimulation(stateInput: SimulationState, inputInput: SimulationInput, irInput: HorizontalMovementIR): SimulationState {
  const state = simulationStateSchema.parse(structuredClone(stateInput));
  const input = simulationInputSchema.parse(inputInput);
  const ir = horizontalMovementIRSchema.parse(structuredClone(irInput));
  const velocityX = signed16(velocityFor(input, ir));
  return simulationStateSchema.parse({ playerX: signed16(state.playerX + velocityX), velocityX, tickCounter: unsigned32(state.tickCounter + 1) });
}

export function simulateScenario(initialState: SimulationState, inputs: readonly SimulationInput[], ir: HorizontalMovementIR): readonly SimulationState[] {
  let state = simulationStateSchema.parse(structuredClone(initialState));
  const states: SimulationState[] = [];
  for (const input of inputs) {
    state = stepSimulation(state, input, ir);
    states.push(state);
  }
  return states;
}

export function generateSimulationSource(irInput: HorizontalMovementIR): string {
  const ir = horizontalMovementIRSchema.parse(structuredClone(irInput));
  const { left, right, idle } = ir.inputMapping;
  return [
    'export type Input = "LEFT" | "RIGHT" | "NONE";',
    "",
    "export interface State {",
    "  playerX: number;",
    "  velocityX: number;",
    "  tickCounter: number;",
    "}",
    "",
    "const signed16 = (value: number): number => ((value + 0x8000) & 0xffff) - 0x8000;",
    "",
    "export function step(state: State, input: Input): State {",
    `  const velocityX = input === "LEFT" ? ${left} : input === "RIGHT" ? ${right} : ${idle};`,
    "  return {",
    "    playerX: signed16(state.playerX + velocityX),",
    "    velocityX,",
    "    tickCounter: (state.tickCounter + 1) >>> 0,",
    "  };",
    "}",
    "",
  ].join("\\n");
}
