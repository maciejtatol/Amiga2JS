import { z } from "zod";

export const runtimeInputSchema = z.enum(["LEFT", "RIGHT", "NONE"]);
export type RuntimeInput = z.infer<typeof runtimeInputSchema>;
export const executableArtifactIdSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);

export const runtimeScenarioSchema = z.object({
  id: z.string().min(1),
  inputs: z.array(runtimeInputSchema),
}).strict();
export type RuntimeScenario = z.infer<typeof runtimeScenarioSchema>;

export const runtimeObservationSchema = z.object({
  scenarioId: z.string().min(1),
  tick: z.number().int().nonnegative(),
  input: runtimeInputSchema,
  state: z.record(z.string(), z.number().finite()),
}).strict();
export type RuntimeObservation = z.infer<typeof runtimeObservationSchema>;

export interface RuntimeOracle {
  load(executableArtifactId: string): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  advanceFrame(): Promise<void>;
  injectKeyboard(input: RuntimeInput): Promise<void>;
  readState(addresses: readonly string[]): Promise<Readonly<Record<string, number>>>;
}

export interface AmiberryTransport {
  request<T>(operation: string, payload?: unknown): Promise<T>;
}

export class AmiberryRuntimeOracle implements RuntimeOracle {
  constructor(private readonly transport: AmiberryTransport) {}

  async load(executableArtifactId: string): Promise<void> {
    const artifactId = executableArtifactIdSchema.parse(executableArtifactId);
    await this.transport.request("load", { executableArtifactId: artifactId });
  }

  async pause(): Promise<void> {
    await this.transport.request("pause");
  }

  async resume(): Promise<void> {
    await this.transport.request("resume");
  }

  async advanceFrame(): Promise<void> {
    await this.transport.request("advance-frame");
  }

  async injectKeyboard(input: RuntimeInput): Promise<void> {
    await this.transport.request("inject-keyboard", { input });
  }

  async readState(addresses: readonly string[]): Promise<Readonly<Record<string, number>>> {
    const state = await this.transport.request<unknown>("read-state", { addresses });
    return z.record(z.string(), z.number().finite()).parse(state);
  }
}

export type ScenarioOracle = Pick<
  RuntimeOracle,
  "pause" | "injectKeyboard" | "advanceFrame" | "readState"
>;

export async function captureScenario(
  oracle: ScenarioOracle,
  scenarioInput: RuntimeScenario,
  addresses: readonly string[],
): Promise<readonly RuntimeObservation[]> {
  const scenario = runtimeScenarioSchema.parse(structuredClone(scenarioInput));
  await oracle.pause();
  const observations: RuntimeObservation[] = [];

  // Keep each observation aligned to one input/frame boundary. This ordering
  // makes replay data deterministic and avoids sampling between frames.
  for (const [tick, input] of scenario.inputs.entries()) {
    await oracle.injectKeyboard(input);
    await oracle.advanceFrame();
    const state = await oracle.readState(addresses);
    observations.push(runtimeObservationSchema.parse({
      scenarioId: scenario.id,
      tick,
      input,
      state: structuredClone(state),
    }));
  }
  return observations;
}
