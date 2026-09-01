import { createHash } from "node:crypto";
import { z } from "zod";

const nonEmpty = z.string().min(1);

export const memoryAccessSchema = z.object({ address: nonEmpty, size: z.number().int().positive() }).strict();
export const staticFunctionSchema = z.object({
  address: nonEmpty, ghidraName: nonEmpty, size: z.number().int().nonnegative(),
  callers: z.array(nonEmpty), callees: z.array(nonEmpty), reads: z.array(memoryAccessSchema),
  writes: z.array(memoryAccessSchema), disassembly: z.string(), decompilation: z.string().optional(),
}).strict();
export const staticAnalysisSnapshotSchema = z.object({
  program: z.object({ format: nonEmpty, languageId: nonEmpty, imageBase: nonEmpty }).strict(),
  memoryBlocks: z.array(z.object({ name: nonEmpty, start: nonEmpty, end: nonEmpty, permissions: nonEmpty }).strict()),
  functions: z.array(staticFunctionSchema),
  xrefs: z.array(z.object({ from: nonEmpty, to: nonEmpty, kind: nonEmpty }).strict()),
  strings: z.array(z.object({ address: nonEmpty, value: z.string() }).strict()),
  symbols: z.array(z.object({ address: nonEmpty, name: nonEmpty, type: nonEmpty }).strict()),
  hardwareAccessCandidates: z.array(z.object({ address: nonEmpty, operation: z.enum(["read", "write"]), evidence: nonEmpty }).strict()),
}).strict();
export type StaticAnalysisSnapshot = z.infer<typeof staticAnalysisSnapshotSchema>;

export interface HeadlessCommandRunner {
  run(command: string, args: readonly string[]): Promise<string>;
}
export interface GhidraHeadlessOptions {
  readonly analyzeHeadless: string;
  readonly projectDirectory: string;
  readonly projectName: string;
  readonly inputPath: string;
  readonly exporterScript: string;
}

const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

function normalizeSnapshotOrder(snapshot: StaticAnalysisSnapshot): StaticAnalysisSnapshot {
  return {
    ...snapshot,
    memoryBlocks: [...snapshot.memoryBlocks].sort((a, b) => compare(a.start, b.start)),
    functions: [...snapshot.functions].sort((a, b) => compare(a.address, b.address)),
    xrefs: [...snapshot.xrefs].sort((a, b) => compare(`${a.from}:${a.to}:${a.kind}`, `${b.from}:${b.to}:${b.kind}`)),
    strings: [...snapshot.strings].sort((a, b) => compare(a.address, b.address)),
    symbols: [...snapshot.symbols].sort((a, b) => compare(`${a.address}:${a.name}`, `${b.address}:${b.name}`)),
    hardwareAccessCandidates: [...snapshot.hardwareAccessCandidates].sort((a, b) => compare(`${a.address}:${a.operation}`, `${b.address}:${b.operation}`)),
  };
}

export function normalizeSnapshot(input: unknown): StaticAnalysisSnapshot {
  return normalizeSnapshotOrder(staticAnalysisSnapshotSchema.parse(structuredClone(input)));
}

export function snapshotDigest(snapshot: StaticAnalysisSnapshot): string {
  return createHash("sha256").update(JSON.stringify(normalizeSnapshot(snapshot))).digest("hex");
}

export class GhidraHeadlessAdapter {
  constructor(private readonly runner: HeadlessCommandRunner) {}

  async analyze(options: GhidraHeadlessOptions): Promise<StaticAnalysisSnapshot> {
    const output = await this.runner.run(options.analyzeHeadless, [
      options.projectDirectory, options.projectName, "-import", options.inputPath,
      "-postScript", options.exporterScript,
    ]);
    const marker = "RETROPORT_SNAPSHOT=";
    const line = output.split("\n").find((candidate) => candidate.startsWith(marker));
    if (!line) throw new Error("Ghidra exporter did not emit a RetroPort snapshot");
    return normalizeSnapshot(JSON.parse(line.slice(marker.length)));
  }
}
