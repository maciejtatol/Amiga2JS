import { describe, expect, it } from "vitest";
import {
  AmiberryRuntimeOracle,
  captureScenario,
  findFirstObservationMismatch,
  HttpAmiberryTransport,
  InMemoryRuntimeObservationRepository,
  type RuntimeInput,
  type RuntimeObservation,
} from "../src/index.js";

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

  it("maps HTTP transport requests and rejects failed responses", async () => {
    const requests: Request[] = [];
    const transport = new HttpAmiberryTransport("http://amiberry/", async (input, init) => {
      requests.push(new Request(input, init));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    await expect(transport.request("pause")).resolves.toEqual({ ok: true });
    expect(requests[0]!.url).toBe("http://amiberry/pause");
    await expect(new HttpAmiberryTransport("http://amiberry", async () =>
      new Response("offline", { status: 503 }),
    ).request("pause")).rejects.toThrow("503");
  });

  it("stores detached observations and rejects duplicate scenarios", async () => {
    const repository = new InMemoryRuntimeObservationRepository();
    const observations: RuntimeObservation[] = [{
      scenarioId: "movement", tick: 0, input: "RIGHT", state: { playerX: 2 },
    }];
    await repository.save(observations);
    observations[0]!.state.playerX = 99;
    await expect(repository.load("movement")).resolves.toEqual([{
      scenarioId: "movement", tick: 0, input: "RIGHT", state: { playerX: 2 },
    }]);
    await expect(repository.save([observations[0]!])).rejects.toThrow("already saved");
  });

  it("reports the first state divergence by tick and field", () => {
    const base: RuntimeObservation[] = [
      { scenarioId: "movement", tick: 0, input: "RIGHT", state: { playerX: 2 } },
      { scenarioId: "movement", tick: 1, input: "RIGHT", state: { playerX: 4 } },
    ];
    expect(findFirstObservationMismatch(base, [
      base[0]!,
      { ...base[1]!, state: { playerX: 5 } },
    ])).toEqual({ tick: 1, field: "playerX", expected: 4, actual: 5 });
  });
});
