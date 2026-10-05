import { createHash } from "node:crypto";
import { z } from "zod";

const HUNK_HEADER = 0x3f3;
const HUNK_CODE = 0x3e9;
const HUNK_DATA = 0x3ea;
const HUNK_BSS = 0x3eb;
const HUNK_RELOC16 = 0x3ed;
const HUNK_RELOC8 = 0x3ee;
const HUNK_END = 0x3f2;
const HUNK_SYMBOL = 0x3f0;
const HUNK_DEBUG = 0x3f1;
const HUNK_RELOC32 = 0x3ec;
const LEFT_VELOCITY = -2;
const RIGHT_VELOCITY = 2;
const IDLE_VELOCITY = 0;

export interface MicroFixtureSource {
  readonly name: "amiga-m68k-horizontal";
  readonly playerX: number;
  readonly velocityX: number;
  readonly inputState: "LEFT" | "RIGHT" | "NONE";
  readonly tickCounter: number;
}
export const microFixtureSourceSchema = z.object({
  name: z.literal("amiga-m68k-horizontal"),
  playerX: z.number().int().min(-32768).max(32767),
  velocityX: z.number().int().min(-32768).max(32767),
  inputState: z.enum(["LEFT", "RIGHT", "NONE"]),
  tickCounter: z.number().int().min(0).max(0xffffffff),
}).strict();

export interface HunkSummary {
  readonly hunkTypes: readonly number[];
  readonly codeBytes: number;
  readonly hasSymbols: boolean;
  readonly hasDebug: boolean;
}

export const fixtureManifestSchema = z.object({
  source: z.string().min(1),
  artifact: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/i),
}).strict();
export type FixtureManifest = z.infer<typeof fixtureManifestSchema>;

export interface FixturePreflightResult {
  readonly artifact: string;
  readonly sha256: string;
  readonly byteLength: number;
  readonly hunk: HunkSummary;
}

const words = (values: readonly number[]): Uint8Array => {
  const output = new Uint8Array(values.length * 4);
  const view = new DataView(output.buffer);
  values.forEach((value, index) => view.setUint32(index * 4, value >>> 0, false));
  return output;
};

const validateSource = (source: MicroFixtureSource): void => {
  microFixtureSourceSchema.parse(source);
};

const signed16 = (value: number): number => {
  const wrapped = ((value + 0x8000) & 0xffff) - 0x8000;
  return wrapped;
};

export interface HorizontalMovementState {
  readonly playerX: number;
  readonly velocityX: number;
  readonly tickCounter: number;
}

const velocityForInput = (input: MicroFixtureSource["inputState"]): number => {
  if (input === "LEFT") return LEFT_VELOCITY;
  if (input === "RIGHT") return RIGHT_VELOCITY;
  return IDLE_VELOCITY;
};

const inputCodeFor = (input: MicroFixtureSource["inputState"]): number => {
  if (input === "LEFT") return 1;
  if (input === "RIGHT") return 2;
  return 0;
};

export function runHorizontalMovement(source: MicroFixtureSource): HorizontalMovementState {
  validateSource(source);
  const velocityX = velocityForInput(source.inputState);
  return { playerX: signed16(source.playerX + velocityX), velocityX, tickCounter: (source.tickCounter + 1) >>> 0 };
}

function readWords(binary: Uint8Array): number[] {
  if (binary.byteLength % 4 !== 0) throw new Error("HUNK binary length must be a multiple of four");
  const view = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
  return Array.from({ length: binary.byteLength / 4 }, (_, index) => view.getUint32(index * 4, false));
}

/** Build the tiny, deterministic fixture used by Phase 0. */
export function buildMicroFixture(source: MicroFixtureSource): Uint8Array {
  validateSource(source);
  const velocityX = velocityForInput(source.inputState);
  const inputCode = inputCodeFor(source.inputState);
  // Synthetic state record: persistent playerX, velocityX, inputState, tickCounter.
  const code = [
    (source.playerX << 16) | (velocityX & 0xffff),
    (inputCode << 16) | (source.tickCounter & 0xffff),
    source.tickCounter >>> 16,
    0x48554e4b,
    0x4e754e71,
  ];
  return concat(words([HUNK_HEADER, 0, 1, 0, 0, code.length, HUNK_CODE, code.length]), words(code), words([HUNK_END]));
}

/** Remove symbols, debug records, and relocations while retaining loadable code. */
export function stripHunk(binary: Uint8Array): Uint8Array {
  const input = readWords(binary);
  validateHeader(input);
  const output = input.slice(0, 6);
  let cursor = 6;
  let ended = false;
  while (cursor < input.length) {
    const type = input[cursor++];
    if (type === undefined) throw new Error("Truncated HUNK record");
    if (type === HUNK_END) {
      output.push(HUNK_END);
      ended = true;
      break;
    }
    const end = nextRecord(input, cursor, type);
    if (type !== HUNK_SYMBOL && type !== HUNK_DEBUG && type !== HUNK_RELOC32) {
      const count = input[cursor]!;
      output.push(type, count, ...input.slice(cursor + 1, cursor + 1 + count));
    }
    cursor = end;
  }
  if (!ended || cursor !== input.length) throw new Error("HUNK binary has trailing data");
  return words(output);
}

export function inspectHunk(binary: Uint8Array): HunkSummary {
  const input = readWords(binary);
  validateHeader(input);
  const hunkTypes: number[] = [];
  let codeBytes = 0;
  let hasSymbols = false;
  let hasDebug = false;
  let ended = false;
  for (let cursor = 6; cursor < input.length;) {
    const type = input[cursor++];
    if (type === undefined) throw new Error("Truncated HUNK record");
    if (type === HUNK_END) { ended = true; if (cursor !== input.length) throw new Error("HUNK binary has trailing data"); break; }
    const count = input[cursor];
    const end = nextRecord(input, cursor, type);
    hunkTypes.push(type);
    if (type === HUNK_CODE) {
      if (count === undefined) throw new Error("Truncated HUNK code record");
      codeBytes += count * 4;
    }
    if (type === HUNK_SYMBOL) hasSymbols = true;
    if (type === HUNK_DEBUG) hasDebug = true;
    cursor = end;
  }
  if (!ended) throw new Error("HUNK binary has no END record");
  return { hunkTypes, codeBytes, hasSymbols, hasDebug };
}

/**
 * Inspect a linked executable HUNK with multiple CODE/DATA/BSS sections.
 * This deliberately validates structure only; relocation semantics remain a
 * later static-analysis concern.
 */
export function inspectHunkExecutable(binary: Uint8Array): HunkSummary {
  const input = readWords(binary);
  let cursor = 0;
  if (input[cursor++] !== HUNK_HEADER) throw new Error("Not an Amiga HUNK binary");

  // Resident-library names precede the hunk table and are terminated by zero.
  while (true) {
    const nameWords = input[cursor++];
    if (nameWords === undefined) throw new Error("Truncated HUNK resident-name table");
    if (nameWords === 0) break;
    cursor = skipWords(input, cursor, nameWords, "HUNK resident-name table");
  }
  const tableSize = input[cursor++];
  const firstHunk = input[cursor++];
  const lastHunk = input[cursor++];
  if (tableSize === undefined || firstHunk === undefined || lastHunk === undefined
    || tableSize === 0 || lastHunk < firstHunk || lastHunk - firstHunk + 1 !== tableSize) {
    throw new Error("Invalid HUNK section table");
  }
  cursor = skipWords(input, cursor, tableSize, "HUNK section table");

  const hunkTypes: number[] = [];
  let codeBytes = 0;
  let hasSymbols = false;
  let hasDebug = false;
  for (let hunkIndex = 0; hunkIndex < tableSize; hunkIndex += 1) {
    const hunkType = input[cursor++];
    if (hunkType === undefined || ![HUNK_CODE, HUNK_DATA, HUNK_BSS].includes(hunkType)) {
      throw new Error("Unsupported or truncated HUNK section");
    }
    const sizeWords = input[cursor++];
    if (sizeWords === undefined) throw new Error("Truncated HUNK section size");
    const sectionWords = sizeWords & 0x3fffffff;
    if (sectionWords === 0 && hunkType !== HUNK_BSS) {
      throw new Error("HUNK CODE/DATA section must not be empty");
    }
    hunkTypes.push(hunkType);
    if (hunkType === HUNK_CODE) codeBytes += sectionWords * 4;
    if (hunkType !== HUNK_BSS) cursor = skipWords(input, cursor, sectionWords, "HUNK section data");

    let ended = false;
    while (cursor < input.length) {
      const recordType = input[cursor++];
      if (recordType === undefined) throw new Error("Truncated HUNK record");
      if (recordType === HUNK_END) {
        ended = true;
        break;
      }
      hunkTypes.push(recordType);
      if ([HUNK_RELOC32, HUNK_RELOC16, HUNK_RELOC8].includes(recordType)) {
        cursor = skipRelocations(input, cursor, `HUNK relocation ${recordType.toString(16)}`);
      } else if (recordType === HUNK_SYMBOL) {
        hasSymbols = true;
        cursor = skipSymbols(input, cursor);
      } else if (recordType === HUNK_DEBUG) {
        hasDebug = true;
        cursor = skipCountedRecord(input, cursor, "HUNK_DEBUG");
      } else if (recordType === HUNK_CODE || recordType === HUNK_DATA || recordType === HUNK_BSS) {
        throw new Error("HUNK section appears before the previous section ended");
      } else {
        throw new Error(`Unsupported HUNK record: 0x${recordType.toString(16)}`);
      }
    }
    if (!ended) throw new Error("HUNK section has no END record");
  }
  if (cursor !== input.length) throw new Error("HUNK binary has trailing data");
  return { hunkTypes, codeBytes, hasSymbols, hasDebug };
}

function skipWords(input: readonly number[], cursor: number, count: number, label: string): number {
  if (!Number.isSafeInteger(count) || count < 0 || cursor + count > input.length) {
    throw new Error(`Truncated ${label}`);
  }
  return cursor + count;
}

function skipCountedRecord(input: readonly number[], cursor: number, label: string): number {
  const count = input[cursor++];
  if (count === undefined) throw new Error(`Truncated ${label}`);
  return skipWords(input, cursor, count, label);
}

function skipRelocations(input: readonly number[], cursor: number, label: string): number {
  while (true) {
    const count = input[cursor++];
    if (count === undefined) throw new Error(`Truncated ${label}`);
    if (count === 0) return cursor;
    cursor = skipWords(input, cursor, 1 + count, label);
  }
}

function skipSymbols(input: readonly number[], cursor: number): number {
  while (true) {
    const nameWords = input[cursor++];
    if (nameWords === undefined) throw new Error("Truncated HUNK_SYMBOL");
    if (nameWords === 0) return cursor;
    cursor = skipWords(input, cursor, nameWords + 1, "HUNK_SYMBOL");
  }
}

/** Validate a fixture's digest and HUNK structure before external analysis. */
export function verifyFixtureArtifact(
  binary: Uint8Array,
  manifestInput: FixtureManifest,
): FixturePreflightResult {
  const manifest = fixtureManifestSchema.parse(structuredClone(manifestInput));
  const sha256 = createHash("sha256").update(binary).digest("hex");
  if (sha256 !== manifest.sha256.toLowerCase()) {
    throw new Error(`Fixture SHA-256 mismatch: expected ${manifest.sha256}, got ${sha256}`);
  }
  return {
    artifact: manifest.artifact,
    sha256,
    byteLength: binary.byteLength,
    hunk: inspectHunk(binary),
  };
}

function validateHeader(input: readonly number[]): void {
  if (input.length < 7 || input[0] !== HUNK_HEADER) throw new Error("Not an Amiga HUNK binary");
  if (input[1] !== 0 || input[2] !== 1 || input[3] !== 0 || input[4] !== 0 || input[5] === undefined || input[5] === 0) {
    throw new Error("Invalid HUNK header");
  }
  if (input[6] !== HUNK_CODE || input[7] === undefined || input[7] !== input[5]) throw new Error("HUNK code size does not match header");
}

function nextRecord(input: readonly number[], start: number, type: number): number {
  let cursor = start;
  if (type === HUNK_SYMBOL) {
    while (true) {
      const nameWords = input[cursor++];
      if (nameWords === undefined) throw new Error("Truncated HUNK symbol record");
      if (nameWords === 0) return cursor;
      cursor += nameWords + 1;
      if (cursor > input.length) throw new Error("Truncated HUNK symbol record");
    }
  }
  if (type === HUNK_RELOC32) {
    while (true) {
      const offsets = input[cursor++];
      if (offsets === undefined) throw new Error("Truncated HUNK relocation record");
      if (offsets === 0) return cursor;
      cursor += offsets + 1;
      if (cursor > input.length) throw new Error("Truncated HUNK relocation record");
    }
  }
  const count = input[cursor++];
  if (count === undefined || cursor + count > input.length) throw new Error("Truncated HUNK record");
  return cursor + count;
}

const concat = (...parts: readonly Uint8Array[]): Uint8Array => {
  const output = new Uint8Array(parts.reduce((size, part) => size + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.byteLength; }
  return output;
};
