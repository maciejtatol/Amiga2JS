import { describe, expect, it } from "vitest";
import { buildMicroFixture, inspectHunk, runHorizontalMovement, stripHunk } from "../src/index.js";

describe("Amiga m68k horizontal fixture", () => {
  it("produces a stable HUNK artifact", () => {
    const binary = buildMicroFixture({ name: "amiga-m68k-horizontal", playerX: 10, velocityX: 2, inputState: "RIGHT", tickCounter: 4 });
    expect(Buffer.from(binary).toString("hex")).toBe(
      "000003f30000000000000001000000000000000000000005000003e900000005000a0002000200040000000048554e4b4e754e71000003f2",
    );
    expect(inspectHunk(binary)).toEqual({ hunkTypes: [0x3e9], codeBytes: 20, hasSymbols: false, hasDebug: false });
  });

  it("strips non-load records deterministically", () => {
    const binary = buildMicroFixture({ name: "amiga-m68k-horizontal", playerX: 0, velocityX: 0, inputState: "NONE", tickCounter: 0 });
    const withMetadata = new Uint8Array(binary.byteLength + 8);
    withMetadata.set(binary);
    const view = new DataView(withMetadata.buffer);
    view.setUint32(binary.byteLength - 4, 0x3f0, false);
    view.setUint32(binary.byteLength, 0, false);
    view.setUint32(binary.byteLength + 4, 0x3f2, false);
    expect(Buffer.from(stripHunk(withMetadata)).toString("hex")).toBe(Buffer.from(binary).toString("hex"));
  });

  it("models deterministic left, right, and idle ticks", () => {
    expect(runHorizontalMovement({ name: "amiga-m68k-horizontal", playerX: 10, velocityX: 0, inputState: "LEFT", tickCounter: 1 })).toEqual({ playerX: 8, velocityX: -2, tickCounter: 2 });
    expect(runHorizontalMovement({ name: "amiga-m68k-horizontal", playerX: 10, velocityX: 0, inputState: "RIGHT", tickCounter: 1 })).toEqual({ playerX: 12, velocityX: 2, tickCounter: 2 });
    expect(runHorizontalMovement({ name: "amiga-m68k-horizontal", playerX: 10, velocityX: 99, inputState: "NONE", tickCounter: 1 })).toEqual({ playerX: 10, velocityX: 0, tickCounter: 2 });
    expect(runHorizontalMovement({ name: "amiga-m68k-horizontal", playerX: 32767, velocityX: 0, inputState: "RIGHT", tickCounter: 0xffffffff })).toEqual({ playerX: -32767, velocityX: 2, tickCounter: 0 });
  });

  it("keeps checked-in source, artifact, and manifest in sync", async () => {
    const fixture = new URL("../../../fixtures/amiga-m68k-horizontal/", import.meta.url);
    const source = JSON.parse(await readFile(new URL("source.json", fixture), "utf8"));
    const artifact = stripHunk(buildMicroFixture(source));
    const hex = (await readFile(new URL("build-stripped.hunk.hex", fixture), "utf8")).trim();
    const manifest = JSON.parse(await readFile(new URL("manifest.json", fixture), "utf8"));
    expect(Buffer.from(artifact).toString("hex")).toBe(hex);
    expect(createHash("sha256").update(artifact).digest("hex")).toBe(manifest.sha256);
  });

  it.each([
    ["missing END", (bytes: Uint8Array) => bytes.slice(0, -4)],
    ["trailing data", (bytes: Uint8Array) => new Uint8Array([...bytes, 0, 0, 0, 0])],
    ["invalid size", (bytes: Uint8Array) => { const copy = new Uint8Array(bytes); new DataView(copy.buffer).setUint32(20, 99, false); return copy; }],
  ])("rejects %s", (_name, mutate) => {
    const binary = buildMicroFixture({ name: "amiga-m68k-horizontal", playerX: 0, velocityX: 0, inputState: "NONE", tickCounter: 0 });
    expect(() => inspectHunk(mutate(binary))).toThrow();
  });
});
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
