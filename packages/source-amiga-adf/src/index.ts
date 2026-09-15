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
