import { describe, expect, it } from "vitest";
import { AmiberryRuntimeOracle, captureScenario, type RuntimeInput } from "../src/index.js";

describe("Amiberry runtime boundary", () => {
  it("maps oracle operations to transport requests", async () => {
    const calls: Array<{ operation: string; payload: unknown }> = [];
    const oracle = new AmiberryRuntimeOracle({
      request: async <T>(operation: string, payload?: unknown): Promise<T> => {
        calls.push({ operation, payload });
        return (operation === "read-state" ? { playerX: 10 } : undefined) as T;
      },
    });
    const artifactId = `sha256:${"a".repeat(64)}`;
    await oracle.load(artifactId);
    await oracle.pause();
    await oracle.injectKeyboard("LEFT");
    await oracle.advanceFrame();
    await oracle.readState(["playerX"]);
    expect(calls).toEqual([
      { operation: "load", payload: { executableArtifactId: artifactId } },
      { operation: "pause", payload: undefined },
      { operation: "inject-keyboard", payload: { input: "LEFT" } },
      { operation: "advance-frame", payload: undefined },
      { operation: "read-state", payload: { addresses: ["playerX"] } },
    ]);
  });

  it("captures ordered observations and detaches state", async () => {
    const inputs: RuntimeInput[] = [];
    let playerX = 0;
    const oracle = {
      pause: async () => undefined,
      injectKeyboard: async (input: RuntimeInput) => { inputs.push(input); },
      advanceFrame: async () => { playerX += inputs.at(-1) === "RIGHT" ? 2 : inputs.at(-1) === "LEFT" ? -2 : 0; },
      readState: async () => ({ playerX }),
    };
    const observations = await captureScenario(oracle, { id: "movement", inputs: ["RIGHT", "NONE", "LEFT"] }, ["playerX"]);
    expect(observations.map(({ tick, input, state }) => [tick, input, state.playerX])).toEqual([
      [0, "RIGHT", 2], [1, "NONE", 2], [2, "LEFT", 0],
    ]);
    expect(observations[0]!.state).not.toBe(observations[1]!.state);
  });

  it("rejects malformed state returned by the runtime", async () => {
    const oracle = new AmiberryRuntimeOracle({
      request: async <T>(): Promise<T> => ({ playerX: Infinity } as T),
    });
    await expect(oracle.readState(["playerX"])).rejects.toThrow();
  });
});
