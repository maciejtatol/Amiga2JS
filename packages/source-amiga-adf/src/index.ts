import { createHash } from "node:crypto";
import { z } from "zod";

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

export type AdfExtractionStatus = "filesystem-ready" | "requires-emulator" | "unsupported";
export type AdfExtractionMethod = "amigados-tool" | "emulator-boot-capture" | "blocked";

export interface AdfExtractionPlan {
  readonly status: AdfExtractionStatus;
  readonly method: AdfExtractionMethod;
  readonly reason: string;
  readonly nextActions: readonly string[];
}

export const adfLicenseStatusSchema = z.enum([
  "owned-dump", "authorized", "redistributable", "unknown",
]);
export type AdfLicenseStatus = z.infer<typeof adfLicenseStatusSchema>;

export const adfProvenanceSchema = z.object({
  source: z.string().min(1),
  licenseStatus: adfLicenseStatusSchema,
  tool: z.string().min(1).optional(),
  notes: z.string().min(1).optional(),
}).strict();
export type AdfProvenance = z.infer<typeof adfProvenanceSchema>;

const adfInspectionSchema = z.object({
  byteLength: z.number().int().positive(),
  sectorCount: z.number().int().positive(),
  geometry: z.enum(["standard-dd", "standard-hd", "non-standard"]),
  sha1: z.string().regex(/^[0-9a-f]{40}$/),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  bootSignature: z.string().length(4).nullable(),
  bootable: z.boolean(),
  rootBlock: z.number().int().nonnegative().nullable(),
  rootBlockType: z.number().int().nonnegative().nullable(),
  contentKind: z.enum(["amigados", "custom-boot", "raw-or-packed"]),
  detectedMarkers: z.array(z.string()),
}).strict();

export const adfSetManifestSchema = z.object({
  schemaVersion: z.literal(1),
  setId: z.string().min(1),
  title: z.string().min(1),
  provenance: adfProvenanceSchema,
  expectedDiskCount: z.number().int().positive(),
  disks: z.array(z.object({
    fileName: z.string().min(1),
    diskNumber: z.number().int().positive().nullable(),
    inspection: adfInspectionSchema,
  }).strict()).min(1),
  validation: z.object({
    complete: z.boolean(),
    valid: z.boolean(),
    issues: z.array(z.object({
      code: z.string().min(1),
      message: z.string().min(1),
      fileName: z.string().min(1).nullable(),
    }).strict()),
  }).strict(),
}).strict();
export type AdfSetManifest = z.infer<typeof adfSetManifestSchema>;

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

/** Select a safe extraction boundary without interpreting executable bytes. */
export function planAdfExtraction(inspection: AdfInspection): AdfExtractionPlan {
  if (inspection.contentKind === "amigados") {
    return {
      status: "filesystem-ready",
      method: "amigados-tool",
      reason: "A conventional AmigaDOS root block is present.",
      nextActions: ["Run an AmigaDOS-aware extractor such as ADFlib/unadf.", "Validate extracted files before HUNK preflight."],
    };
  }
  if (inspection.bootable || inspection.detectedMarkers.length > 0) {
    return {
      status: "requires-emulator",
      method: "emulator-boot-capture",
      reason: "The image uses custom boot code or packed/protection markers.",
      nextActions: ["Boot the image in an Amiga emulator with the matching configuration.", "Capture loader memory and disk-swap events.", "Run HUNK preflight only on an extracted executable."],
    };
  }
  return {
    status: "unsupported",
    method: "blocked",
    reason: "No supported AmigaDOS structure or recognized boot path was detected.",
    nextActions: ["Obtain a complete image dump or add a format-specific decoder."],
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

/** Build a reviewable, hash-preserving manifest from an ADF set inspection. */
export function createAdfSetManifest(input: {
  readonly setId: string;
  readonly title: string;
  readonly provenance: AdfProvenance;
  readonly inspection: AdfSetInspection;
}): AdfSetManifest {
  const provenance = adfProvenanceSchema.parse(structuredClone(input.provenance));
  return adfSetManifestSchema.parse({
    schemaVersion: 1,
    setId: input.setId,
    title: input.title,
    provenance,
    expectedDiskCount: input.inspection.expectedDiskCount,
    disks: input.inspection.disks,
    validation: {
      complete: input.inspection.complete,
      valid: input.inspection.valid,
      issues: input.inspection.issues,
    },
  });
}
