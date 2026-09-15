import { createHash } from "node:crypto";

const DD_BYTES = 80 * 2 * 11 * 512;
const HD_BYTES = 80 * 2 * 22 * 512;
const ROOT_BLOCK_TYPE = 2;

const markerDefinitions = [
  { label: "Copylock", bytes: Buffer.from("Copylock", "ascii") },
  { label: "ATN!", bytes: Buffer.from("ATN!", "ascii") },
] as const;

export type AdfGeometry = "standard-dd" | "standard-hd" | "non-standard";
export type AdfContentKind = "amigados" | "custom-boot" | "raw-or-packed";

export interface AdfInspection {
  readonly byteLength: number;
  readonly sectorCount: number;
  readonly geometry: AdfGeometry;
  readonly sha1: string;
  readonly sha256: string;
  readonly bootSignature: string | null;
  readonly bootable: boolean;
  readonly rootBlock: number | null;
  readonly rootBlockType: number | null;
  readonly contentKind: AdfContentKind;
  readonly detectedMarkers: readonly string[];
}

export interface AdfDiskInput {
  readonly fileName: string;
  readonly diskNumber: number | null;
  readonly input: Uint8Array;
}

export interface AdfDiskRecord {
  readonly fileName: string;
  readonly diskNumber: number | null;
  readonly inspection: AdfInspection;
}

export type AdfSetIssueCode =
  | "MISSING_DISK_NUMBER"
  | "DUPLICATE_DISK_NUMBER"
  | "OUT_OF_RANGE_DISK_NUMBER"
  | "MISSING_DISK"
  | "NON_STANDARD_GEOMETRY"
  | "INCONSISTENT_GEOMETRY";

export interface AdfSetIssue {
  readonly code: AdfSetIssueCode;
  readonly message: string;
  readonly fileName: string | null;
}

export interface AdfSetInspection {
  readonly expectedDiskCount: number;
  readonly disks: readonly AdfDiskRecord[];
  readonly complete: boolean;
  readonly valid: boolean;
  readonly issues: readonly AdfSetIssue[];
}

function asciiAt(input: Uint8Array, offset: number, length: number): string | null {
  if (offset < 0 || offset + length > input.length) return null;
  return Buffer.from(input.subarray(offset, offset + length)).toString("ascii");
}

function findMarker(input: Uint8Array, marker: Uint8Array): boolean {
  if (marker.length > input.length) return false;
  outer: for (let offset = 0; offset <= input.length - marker.length; offset += 1) {
    for (let index = 0; index < marker.length; index += 1) {
      if (input[offset + index] !== marker[index]) continue outer;
    }
    return true;
  }
  return false;
}

function readUint32BE(input: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset + 4 > input.length) return null;
  return new DataView(input.buffer, input.byteOffset, input.byteLength).getUint32(offset, false);
}

/** Inspect an ADF container without interpreting its executable payload. */
export function inspectAdf(input: Uint8Array): AdfInspection {
  if (input.length === 0) throw new Error("ADF input must not be empty");

  const sectorCount = Math.floor(input.length / 512);
  const standardGeometry: AdfGeometry = input.length === DD_BYTES
    ? "standard-dd"
    : input.length === HD_BYTES
      ? "standard-hd"
      : "non-standard";
  const bootSignature = asciiAt(input, 0, 4);
  const bootable = bootSignature === "DOS\0";
  const rootBlock = standardGeometry === "standard-dd"
    ? 880
    : standardGeometry === "standard-hd"
      ? 1760
      : null;
  const rootBlockType = rootBlock === null
    ? null
    : readUint32BE(input, rootBlock * 512);
  const detectedMarkers = markerDefinitions
    .filter(({ bytes }) => findMarker(input, bytes))
    .map(({ label }) => label);
  const contentKind: AdfContentKind = rootBlockType === ROOT_BLOCK_TYPE
    ? "amigados"
    : bootable
      ? "custom-boot"
      : "raw-or-packed";

  return {
    byteLength: input.length,
    sectorCount,
    geometry: standardGeometry,
    sha1: createHash("sha1").update(input).digest("hex"),
    sha256: createHash("sha256").update(input).digest("hex"),
    bootSignature,
    bootable,
    rootBlock,
    rootBlockType,
    contentKind,
    detectedMarkers,
  };
}

/** Extract a disk number from common TOSEC or simple numbered filenames. */
export function parseAdfDiskNumber(fileName: string): number | null {
  const diskLabel = fileName.match(/disk[\s_-]*(\d+)/i);
  const suffix = fileName.match(/(?:^|[_\s-])(\d+)(?=\.adf$)/i);
  const value = diskLabel?.[1] ?? suffix?.[1];
  if (value === undefined) return null;
  const number = Number.parseInt(value, 10);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

/** Inspect and validate a complete ordered set of ADF disks. */
export function inspectAdfSet(
  inputs: readonly AdfDiskInput[],
  expectedDiskCount?: number,
): AdfSetInspection {
  if (inputs.length === 0) throw new Error("ADF disk set must contain at least one image");
  if (expectedDiskCount !== undefined
    && (!Number.isSafeInteger(expectedDiskCount) || expectedDiskCount < 1)) {
    throw new Error("expectedDiskCount must be a positive integer");
  }

  const disks = inputs.map(({ fileName, diskNumber, input }) => ({
    fileName,
    diskNumber,
    inspection: inspectAdf(input),
  }));
  const numbered = disks
    .map(({ diskNumber }) => diskNumber)
    .filter((number): number is number => number !== null);
  const inferredCount = numbered.length === 0
    ? disks.length
    : Math.max(...numbered);
  const count = expectedDiskCount ?? inferredCount;
  const issues: AdfSetIssue[] = [];
  const addIssue = (code: AdfSetIssueCode, message: string, fileName: string | null = null) => {
    issues.push({ code, message, fileName });
  };

  const byNumber = new Map<number, AdfDiskRecord>();
  for (const disk of disks) {
    if (disk.diskNumber === null) {
      addIssue("MISSING_DISK_NUMBER", `Cannot determine disk number for ${disk.fileName}`, disk.fileName);
      continue;
    }
    if (disk.diskNumber > count) {
      addIssue("OUT_OF_RANGE_DISK_NUMBER", `Disk ${disk.diskNumber} is outside the expected 1-${count} range`, disk.fileName);
    }
    if (byNumber.has(disk.diskNumber)) {
      addIssue("DUPLICATE_DISK_NUMBER", `Disk number ${disk.diskNumber} appears more than once`, disk.fileName);
    } else {
      byNumber.set(disk.diskNumber, disk);
    }
  }
  for (let number = 1; number <= count; number += 1) {
    if (!byNumber.has(number)) addIssue("MISSING_DISK", `Disk ${number} is missing`);
  }

  const geometries = new Set(disks.map(({ inspection }) => inspection.geometry));
  const nonStandardFiles = disks
    .filter(({ inspection }) => inspection.geometry === "non-standard")
    .map(({ fileName }) => fileName);
  if (nonStandardFiles.length > 0) {
    addIssue(
      "NON_STANDARD_GEOMETRY",
      `Non-standard ADF geometry detected in: ${nonStandardFiles.join(", ")}`,
    );
  }
  if (geometries.size > 1) {
    addIssue(
      "INCONSISTENT_GEOMETRY",
      `The disk set mixes ADF geometries: ${[...geometries].join(", ")}`,
    );
  }

  const structuralIssueCodes = new Set<AdfSetIssueCode>([
    "MISSING_DISK_NUMBER", "DUPLICATE_DISK_NUMBER", "OUT_OF_RANGE_DISK_NUMBER", "MISSING_DISK",
  ]);
  return {
    expectedDiskCount: count,
    disks,
    complete: issues.every(({ code }) => !structuralIssueCodes.has(code)),
    valid: issues.length === 0,
    issues,
  };
}
