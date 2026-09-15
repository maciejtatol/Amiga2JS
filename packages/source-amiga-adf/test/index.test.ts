import { describe, expect, it } from "vitest";
import { inspectAdf } from "../src/index.js";

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
