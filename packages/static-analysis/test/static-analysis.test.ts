import { describe, expect, it } from "vitest";
import { GhidraHeadlessAdapter, normalizeSnapshot, snapshotDigest, type StaticAnalysisSnapshot } from "../src/index.js";

const snapshot: StaticAnalysisSnapshot = {
  program: { format: "HUNK", languageId: "68000:BE:32:default", imageBase: "0x1000" },
  memoryBlocks: [{ name: "CODE", start: "0x1000", end: "0x1008", permissions: "r-x" }],
  functions: [{ address: "0x1000", ghidraName: "FUN_1000", size: 8, callers: [], callees: [], reads: [], writes: [], disassembly: "rts" }],
  xrefs: [], strings: [], symbols: [], hardwareAccessCandidates: [],
};

describe("static analysis boundary", () => {
  it("normalizes collection order without mutating input", () => {
    const input = { ...snapshot, functions: [...snapshot.functions].reverse() };
    expect(normalizeSnapshot(input)).toEqual(snapshot);
    expect(input.functions).toEqual(snapshot.functions);
  });

  it("produces a stable digest for equivalent ordering", () => {
    expect(snapshotDigest(snapshot)).toBe(snapshotDigest({
      ...snapshot, functions: [...snapshot.functions].reverse(),
    }));
  });

  it("parses the exporter marker through the command boundary", async () => {
    const calls: string[][] = [];
    const adapter = new GhidraHeadlessAdapter({
      run: async (command, args) => { calls.push([command, ...args]); return `log\nRETROPORT_SNAPSHOT=${JSON.stringify(snapshot)}`; },
    });
    await expect(adapter.analyze({ analyzeHeadless: "analyzeHeadless", projectDirectory: "/tmp/project", projectName: "fixture", inputPath: "/tmp/fixture.hunk", exporterScript: "export.py" })).resolves.toEqual(snapshot);
    expect(calls[0]).toEqual(["analyzeHeadless", "/tmp/project", "fixture", "-import", "/tmp/fixture.hunk", "-postScript", "export.py"]);
  });

  it("rejects output without a snapshot marker", async () => {
    const adapter = new GhidraHeadlessAdapter({ run: async () => "analysis complete" });
    await expect(adapter.analyze({ analyzeHeadless: "analyzeHeadless", projectDirectory: "/tmp/project", projectName: "fixture", inputPath: "/tmp/fixture.hunk", exporterScript: "export.py" })).rejects.toThrow("did not emit");
  });
});
