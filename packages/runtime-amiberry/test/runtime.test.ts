import { describe, expect, it } from "vitest";
import {
  AmiberryRuntimeOracle,
  captureScenario,
  captureScenarioWithDiskSwaps,
  findFirstObservationMismatch,
  HttpAmiberryTransport,
  InMemoryRuntimeObservationRepository,
  normalizeDiskSwapJournal,
  normalizeDiskSwapState,
  replayDiskSwapJournal,
  runStatePatchExperiment,
  type FloppyDrive,
  type RuntimeInput,
  type RuntimeObservation,
} from "../src/index.js";

describe("Amiberry runtime boundary", () => {
  it("maps oracle operations to transport requests", async () => {
    const calls: Array<{ operation: string; payload: unknown }> = [];
    const oracle = new AmiberryRuntimeOracle({
      request: async <T>(operation: string, payload?: unknown): Promise<T> => {
        calls.push({ operation, payload });
        return (
          operation === "read-state"
            ? { playerX: 10 }
            : operation === "query-disk-swap"
              ? { drives: [] }
              : undefined
        ) as T;
      },
    });
    const artifactId = `sha256:${"a".repeat(64)}`;
    await oracle.load(artifactId);
    await oracle.insertFloppy(0, `sha256:${"b".repeat(64)}`);
    await oracle.ejectFloppy(0);
    await oracle.queryDiskSwap();
    await oracle.pause();
    await oracle.injectKeyboard("LEFT");
    await oracle.advanceFrame();
    await oracle.readState(["playerX"]);
    await oracle.writeState({ playerX: 100 });
    expect(calls).toEqual([
      { operation: "load", payload: { executableArtifactId: artifactId } },
      { operation: "insert-floppy", payload: { drive: 0, artifactId: `sha256:${"b".repeat(64)}` } },
      { operation: "eject-floppy", payload: { drive: 0 } },
      { operation: "query-disk-swap", payload: undefined },
      { operation: "pause", payload: undefined },
      { operation: "inject-keyboard", payload: { input: "LEFT" } },
      { operation: "advance-frame", payload: undefined },
      { operation: "read-state", payload: { addresses: ["playerX"] } },
      { operation: "write-state", payload: { state: { playerX: 100 } } },
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

  it("captures disk changes at frame boundaries", async () => {
    const artifactA = `sha256:${"a".repeat(64)}`;
    const artifactB = `sha256:${"b".repeat(64)}`;
    const diskStates = [
      { drives: [{ drive: 0, artifactId: artifactA }] },
      { drives: [{ drive: 0, artifactId: artifactA }] },
      { drives: [{ drive: 0, artifactId: artifactB }] },
      { drives: [] },
    ];
    const oracle = {
      pause: async () => undefined,
      injectKeyboard: async () => undefined,
      advanceFrame: async () => undefined,
      readState: async () => ({ playerX: 1 }),
      queryDiskSwap: async () => diskStates.shift() ?? { drives: [] },
    };
    await expect(captureScenarioWithDiskSwaps(oracle, {
      id: "disked-movement",
      inputs: ["NONE", "RIGHT", "NONE"],
    }, ["playerX"])).resolves.toMatchObject({
      observations: [
        { scenarioId: "disked-movement", tick: 0 },
        { scenarioId: "disked-movement", tick: 1 },
        { scenarioId: "disked-movement", tick: 2 },
      ],
      diskSwapJournal: {
        schemaVersion: 1,
        initialState: { drives: [{ drive: 0, artifactId: artifactA }] },
        events: [
          { tick: 1, action: "insert", drive: 0, artifactId: artifactB },
          { tick: 2, action: "eject", drive: 0, artifactId: null },
        ],
      },
    });
  });

  it("runs a one-frame state patch experiment in a fixed order", async () => {
    let playerX = 10;
    let input: RuntimeInput = "NONE";
    const oracle = {
      pause: async () => undefined,
      writeState: async (state: Readonly<Record<string, number>>) => {
        playerX = state.playerX ?? playerX;
      },
      injectKeyboard: async (nextInput: RuntimeInput) => { input = nextInput; },
      advanceFrame: async () => {
        playerX += input === "RIGHT" ? 2 : input === "LEFT" ? -2 : 0;
      },
      readState: async () => ({ playerX }),
    };
    await expect(runStatePatchExperiment(oracle, {
      field: "playerX",
      patchedValue: 100,
      input: "RIGHT",
      addresses: ["playerX"],
    })).resolves.toEqual({ field: "playerX", input: "RIGHT", before: 10, patched: 100, after: 102, delta: 2 });
  });

  it("rejects malformed state returned by the runtime", async () => {
    const oracle = new AmiberryRuntimeOracle({
      request: async <T>(): Promise<T> => ({ playerX: Infinity } as T),
    });
    await expect(oracle.readState(["playerX"])).rejects.toThrow();
  });

  it("validates disk operations and query state", async () => {
    const oracle = new AmiberryRuntimeOracle({
      request: async <T>(operation: string): Promise<T> => (
        operation === "query-disk-swap"
          ? { drives: [{ drive: 0, artifactId: `sha256:${"c".repeat(64)}` }] }
          : undefined
      ) as T,
    });
    await expect(oracle.queryDiskSwap()).resolves.toEqual({
      drives: [{ drive: 0, artifactId: `sha256:${"c".repeat(64)}` }],
    });
    await expect(oracle.insertFloppy(4 as FloppyDrive, `sha256:${"d".repeat(64)}`)).rejects.toThrow();
    await expect(oracle.ejectFloppy(0)).resolves.toBeUndefined();
  });

  it("normalizes disk state and rejects duplicate drives", () => {
    expect(normalizeDiskSwapState({ drives: [
      { drive: 2, artifactId: null },
      { drive: 0, artifactId: `sha256:${"a".repeat(64)}` },
    ] })).toEqual({ drives: [
      { drive: 0, artifactId: `sha256:${"a".repeat(64)}` },
      { drive: 2, artifactId: null },
    ] });
    expect(() => normalizeDiskSwapState({ drives: [
      { drive: 1, artifactId: null },
      { drive: 1, artifactId: null },
    ] })).toThrow("appears more than once");
  });

  it("replays ordered disk swaps at frame boundaries", async () => {
    const calls: string[] = [];
    const states = [
      { drives: [{ drive: 0, artifactId: `sha256:${"a".repeat(64)}` }] },
      { drives: [{ drive: 0, artifactId: null }] },
    ];
    const oracle = {
      pause: async () => { calls.push("pause"); },
      advanceFrame: async () => { calls.push("frame"); },
      insertFloppy: async (drive: number, artifactId: string) => { calls.push(`insert:${drive}:${artifactId}`); },
      ejectFloppy: async (drive: number) => { calls.push(`eject:${drive}`); },
      queryDiskSwap: async () => states.shift() ?? { drives: [] },
    };
    await expect(replayDiskSwapJournal(oracle, {
      schemaVersion: 1,
      events: [
        { tick: 2, action: "eject", drive: 0, artifactId: null },
        { tick: 0, action: "insert", drive: 0, artifactId: `sha256:${"a".repeat(64)}` },
      ],
    })).rejects.toThrow("ordered by tick");
    const snapshots = await replayDiskSwapJournal(oracle, {
      schemaVersion: 1,
      events: [
        { tick: 0, action: "insert", drive: 0, artifactId: `sha256:${"a".repeat(64)}` },
        { tick: 2, action: "eject", drive: 0, artifactId: null },
      ],
    });
    expect(calls).toEqual([
      "pause",
      `insert:0:sha256:${"a".repeat(64)}`,
      "frame",
      "frame",
      "eject:0",
    ]);
    expect(snapshots.map(({ event, state }) => [event.tick, state.drives[0]?.artifactId])).toEqual([
      [0, `sha256:${"a".repeat(64)}`],
      [2, null],
    ]);
  });

  it("rejects ambiguous journal events", () => {
    expect(() => normalizeDiskSwapJournal({
      schemaVersion: 1,
      events: [
        { tick: 1, action: "eject", drive: 0, artifactId: null },
        { tick: 1, action: "insert", drive: 0, artifactId: `sha256:${"b".repeat(64)}` },
      ],
    })).toThrow("multiple events for 1:0");
  });

  it("rejects malformed state patches before sending them", async () => {
    const request = async <T>(): Promise<T> => undefined as T;
    const oracle = new AmiberryRuntimeOracle({ request });
    await expect(oracle.writeState({ playerX: Number.NaN })).rejects.toThrow();
    await expect(oracle.writeState({})).rejects.toThrow("cannot be empty");
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
