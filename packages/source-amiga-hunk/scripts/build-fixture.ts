import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { buildMicroFixture, microFixtureSourceSchema, stripHunk } from "../src/index.js";

const fixtureDirectory = new URL("../../../fixtures/amiga-m68k-horizontal/", import.meta.url);
const source = microFixtureSourceSchema.parse(JSON.parse(await readFile(new URL("source.json", fixtureDirectory), "utf8")));
const artifact = stripHunk(buildMicroFixture(source));
const hex = Buffer.from(artifact).toString("hex");
const sha256 = createHash("sha256").update(artifact).digest("hex");
await writeFile(new URL("build-stripped.hunk.hex", fixtureDirectory), `${hex}\n`);
await writeFile(new URL("manifest.json", fixtureDirectory), `${JSON.stringify({ source: "source.json", artifact: "build-stripped.hunk.hex", sha256 }, null, 2)}\n`);
console.log(`built ${artifact.byteLength} bytes (sha256:${sha256})`);
