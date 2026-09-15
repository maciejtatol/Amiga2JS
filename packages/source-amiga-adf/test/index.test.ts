import { describe, expect, it } from "vitest";
import { inspectAdf, inspectAdfSet, parseAdfDiskNumber } from "../src/index.js";

const ddBytes = 80 * 2 * 11 * 512;

describe("inspectAdf", () => {
  it("recognizes a standard AmigaDOS double-density image", () => {
    const image = new Uint8Array(ddBytes);
    image.set([0x44, 0x4f, 0x53, 0x00]);
    new DataView(image.buffer).setUint32(880 * 512, 2, false);

    expect(inspectAdf(image)).toMatchObject({
      byteLength: ddBytes,
      sectorCount: 1760,
      geometry: "standard-dd",
      bootSignature: "DOS\0",
      bootable: true,
      rootBlock: 880,
      rootBlockType: 2,
      contentKind: "amigados",
      detectedMarkers: [],
    });
  });

  it("flags a bootable custom/protected image when no root block is present", () => {
    const image = new Uint8Array(ddBytes);
    image.set([0x44, 0x4f, 0x53, 0x00]);
    image.set(Buffer.from("Copylock", "ascii"), 1024);

    expect(inspectAdf(image)).toMatchObject({
      geometry: "standard-dd",
      contentKind: "custom-boot",
      detectedMarkers: ["Copylock"],
    });
  });

  it("flags packed/raw images and preserves non-standard geometry", () => {
    const image = new Uint8Array(889_856);
    image.set(Buffer.from("ATN!", "ascii"));

    expect(inspectAdf(image)).toMatchObject({
      byteLength: 889_856,
      sectorCount: 1738,
      geometry: "non-standard",
      bootable: false,
      rootBlock: null,
      rootBlockType: null,
      contentKind: "raw-or-packed",
      detectedMarkers: ["ATN!"],
    });
  });

  it("rejects an empty image", () => {
    expect(() => inspectAdf(new Uint8Array())).toThrow("ADF input must not be empty");
  });
});

describe("ADF disk sets", () => {
  it("parses common disk filename conventions", () => {
    expect(parseAdfDiskNumber("Superfrog_1.adf")).toBe(1);
    expect(parseAdfDiskNumber("Game (Disk 3 of 4).adf")).toBe(3);
    expect(parseAdfDiskNumber("readme.adf")).toBeNull();
  });

  it("accepts a complete, consistently sized ordered set", () => {
    const image = new Uint8Array(ddBytes);
    expect(inspectAdfSet([
      { fileName: "Game_1.adf", diskNumber: 1, input: image },
      { fileName: "Game_2.adf", diskNumber: 2, input: image },
    ], 2)).toMatchObject({ expectedDiskCount: 2, complete: true, valid: true, issues: [] });
  });

  it("reports missing disks and unsafe geometry before extraction", () => {
    const image = new Uint8Array(ddBytes);
    const truncated = new Uint8Array(889_856);
    const result = inspectAdfSet([
      { fileName: "Game_1.adf", diskNumber: 1, input: image },
      { fileName: "Game_3.adf", diskNumber: 3, input: truncated },
    ], 3);

    expect(result.complete).toBe(false);
    expect(result.valid).toBe(false);
    expect(result.issues.map(({ code }) => code)).toEqual([
      "MISSING_DISK",
      "NON_STANDARD_GEOMETRY",
      "INCONSISTENT_GEOMETRY",
    ]);
  });

  it("rejects duplicate disk numbers", () => {
    const image = new Uint8Array(ddBytes);
    const result = inspectAdfSet([
      { fileName: "Game_1a.adf", diskNumber: 1, input: image },
      { fileName: "Game_1b.adf", diskNumber: 1, input: image },
    ], 1);

    expect(result.valid).toBe(false);
    expect(result.issues[0]?.code).toBe("DUPLICATE_DISK_NUMBER");
  });
});
