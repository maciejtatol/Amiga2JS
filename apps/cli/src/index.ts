#!/usr/bin/env node
import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { diagnoseProject, loadCompatibilityRules } from "@retroport/compatibility";
import { horizontalMovementIRSchema, projectManifestSchema } from "@retroport/schemas";
import {
  captureScenario,
  diskSwapReplaySchema,
  HttpAmiberryTransport,
  runStatePatchExperiment,
  runtimeObservationSchema,
  runtimeInputSchema,
  runtimeScenarioSchema,
  AmiberryRuntimeOracle,
  replayDiskSwapJournal,
} from "@retroport/runtime-amiberry";
import { runPhase0AcceptanceSuite, verifyScenario } from "@retroport/verification";
import { generateSimulationSource, simulationStateSchema } from "@retroport/target-typescript";
import {
  GhidraHeadlessAdapter,
  NodeHeadlessCommandRunner,
  staticAnalysisSnapshotSchema,
} from "@retroport/static-analysis";
import {
  fixtureManifestSchema,
  inspectHunk,
  verifyFixtureArtifact,
} from "@retroport/source-amiga-hunk";
import {
  adfProvenanceSchema,
  createAdfExtractionRecord,
  createAdfSetManifest,
  inspectAdf,
  inspectAdfSet,
  planAdfExtraction,
  parseAdfDiskNumber,
} from "@retroport/source-amiga-adf";
import {
  runCapturedPhase0Pipeline,
  runMicroFixturePipeline,
} from "@retroport/phase0-pipeline";
import {
  analyzeHorizontalMovement,
  gradeHorizontalMovement,
  movementCandidateToIR,
  movementGroundTruthSchema,
  movementIRMetadataSchema,
  reviewHorizontalMovement,
} from "@retroport/reconstruction";

function optionValue(args: string[], option: string): string | undefined {
  const index = args.indexOf(option);
  const value = index === -1 ? undefined : args[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

async function run(): Promise<void> {
  const [, , command, ...args] = process.argv;
  if (command === "analyze") {
    await runAnalyze(args);
    return;
  }
  if (command === "inspect") {
    await runInspect(args);
    return;
  }
  if (command === "inspect-adf") {
    await runInspectAdf(args);
    return;
  }
  if (command === "inspect-adf-set") {
    await runInspectAdfSet(args);
    return;
  }
  if (command === "write-adf-manifest") {
    await runWriteAdfManifest(args);
    return;
  }
  if (command === "plan-adf-extraction") {
    await runPlanAdfExtraction(args);
    return;
  }
  if (command === "record-adf-extraction") {
    await runRecordAdfExtraction(args);
    return;
  }
  if (command === "replay-disk-swap") {
    await runReplayDiskSwap(args);
    return;
  }
  if (command === "preflight") {
    await runPreflight(args);
    return;
  }
  if (command === "reconstruct") {
    await runReconstruct(args);
    return;
  }
  if (command === "generate") {
    await runGenerate(args);
    return;
  }
  if (command === "grade") {
    await runGrade(args);
    return;
  }
  if (command === "capture") {
    await runCapture(args);
    return;
  }
  if (command === "experiment") {
    await runExperiment(args);
    return;
  }
  if (command === "phase0") {
    runPhase0();
    return;
  }
  if (command === "phase0-captured") {
    await runCapturedPhase0(args);
    return;
  }
  if (command === "verify") {
    await runVerify(args);
    return;
  }
  if (command === "acceptance") {
    await runAcceptance();
    return;
  }
  if (command !== "doctor") {
    throw new Error("Usage: retroport doctor ... | retroport inspect ... | retroport inspect-adf ... | retroport inspect-adf-set ... | retroport write-adf-manifest ... | retroport plan-adf-extraction ... | retroport record-adf-extraction ... | retroport replay-disk-swap ... | retroport preflight ... | retroport reconstruct ... | retroport generate ... | retroport grade ... | retroport analyze ... | retroport capture ... | retroport experiment ... | retroport phase0 ... | retroport phase0-captured ... | retroport verify ... | retroport acceptance");
  }
  const manifestPath = optionValue(args, "--manifest");
  const rulesPath = optionValue(args, "--rules");
  if (!manifestPath || !rulesPath) {
    throw new Error("doctor requires --manifest <file.json> and --rules <directory>");
  }
  const invocationDirectory = process.env.INIT_CWD ?? process.cwd();
  const manifest = projectManifestSchema.parse(
    JSON.parse(await readFile(resolve(invocationDirectory, manifestPath), "utf8")),
  );
  const rules = await loadCompatibilityRules(resolve(invocationDirectory, rulesPath));
  const diagnosis = diagnoseProject(manifest, rules);
  console.log(diagnosis.classification);
  for (const warningId of diagnosis.warningIds) console.log(`- ${warningId}`);
}

function decodeHunkInput(input: Uint8Array, description = "input"): Uint8Array {
  // Repository fixtures are stored as text so they remain reviewable in Git;
  // production callers may provide the equivalent binary HUNK directly.
  const hunkMagic = [0x00, 0x00, 0x03, 0xf3];
  const isBinaryHunk = hunkMagic.every((byte, index) => input[index] === byte);
  if (isBinaryHunk) {
    return input;
  }
  const text = Buffer.from(input).toString("utf8").trim();
  if (!/^[0-9a-f]+$/i.test(text) || text.length % 2 !== 0) {
    throw new Error(`${description} must be a binary HUNK or an even-length hexadecimal file`);
  }
  return new Uint8Array(Buffer.from(text, "hex"));
}

async function runInspect(args: string[]): Promise<void> {
  const inputPath = optionValue(args, "--input");
  if (!inputPath) throw new Error("inspect requires --input <file>");
  const invocationDirectory = process.env.INIT_CWD ?? process.cwd();
  const input = decodeHunkInput(await readFile(resolve(invocationDirectory, inputPath)));
  console.log(JSON.stringify(inspectHunk(input), null, 2));
}

async function runInspectAdf(args: string[]): Promise<void> {
  const inputPath = optionValue(args, "--input");
  if (!inputPath) throw new Error("inspect-adf requires --input <file>");
  const invocationDirectory = process.env.INIT_CWD ?? process.cwd();
  const resolvedPath = resolve(invocationDirectory, inputPath);
  const inspection = inspectAdf(await readFile(resolvedPath));
  console.log(JSON.stringify({ file: inputPath, ...inspection }, null, 2));
}

async function runPlanAdfExtraction(args: string[]): Promise<void> {
  const inputPath = optionValue(args, "--input");
  if (!inputPath) throw new Error("plan-adf-extraction requires --input <file.adf>");
  const invocationDirectory = process.env.INIT_CWD ?? process.cwd();
  const inspection = inspectAdf(await readFile(resolve(invocationDirectory, inputPath)));
  const plan = planAdfExtraction(inspection);
  console.log(JSON.stringify({ file: inputPath, inspection, plan }, null, 2));
  if (plan.status !== "filesystem-ready") process.exitCode = 1;
}

async function runRecordAdfExtraction(args: string[]): Promise<void> {
  const diskPath = optionValue(args, "--disk");
  const artifactPath = optionValue(args, "--artifact");
  const outputPath = optionValue(args, "--output");
  const format = optionValue(args, "--format");
  const method = optionValue(args, "--method");
  if (!diskPath || !artifactPath || !outputPath || !format || !method) {
    throw new Error("record-adf-extraction requires --disk, --artifact, --output, --format, and --method");
  }
  const invocationDirectory = process.env.INIT_CWD ?? process.cwd();
  const disk = await readFile(resolve(invocationDirectory, diskPath));
  const diskInspection = inspectAdf(disk);
  const allowedFormats = ["hunk", "raw-memory-dump", "unknown"] as const;
  const allowedMethods = ["amigados-tool", "emulator-memory-dump", "manual"] as const;
  if (!allowedFormats.includes(format as typeof allowedFormats[number])) {
    throw new Error("--format must be hunk, raw-memory-dump, or unknown");
  }
  if (!allowedMethods.includes(method as typeof allowedMethods[number])) {
    throw new Error("--method must be amigados-tool, emulator-memory-dump, or manual");
  }
  const artifactInput = await readFile(resolve(invocationDirectory, artifactPath));
  // HUNK records must contain the decoded executable bytes that downstream
  // preflight and Ghidra consume. The same hex fixture convention as
  // `retroport inspect` is accepted, but it is always validated here.
  const artifact = format === "hunk"
    ? decodeHunkInput(artifactInput, "artifact")
    : artifactInput;
  if (format === "hunk") inspectHunk(artifact);
  const notes = optionValue(args, "--notes");
  const record = createAdfExtractionRecord({
    parentDiskSha256: diskInspection.sha256,
    artifact,
    artifactFormat: format as typeof allowedFormats[number],
    extractionMethod: method as typeof allowedMethods[number],
    sourceFile: artifactPath,
    ...(notes === undefined
      ? {}
      : { notes }),
  });
  await writeFile(
    resolve(invocationDirectory, outputPath),
    `${JSON.stringify(record, null, 2)}\n`,
    "utf8",
  );
  console.log(JSON.stringify(record, null, 2));
}

async function runReplayDiskSwap(args: string[]): Promise<void> {
  const journalPath = optionValue(args, "--journal");
  const server = optionValue(args, "--server");
  if (!journalPath || !server) {
    throw new Error("replay-disk-swap requires --journal <file.json> and --server <url>");
  }
  const invocationDirectory = process.env.INIT_CWD ?? process.cwd();
  const journal = JSON.parse(await readFile(
    resolve(invocationDirectory, journalPath),
    "utf8",
  ));
  const oracle = new AmiberryRuntimeOracle(new HttpAmiberryTransport(server));
  const snapshots = await replayDiskSwapJournal(oracle, journal);
  const replay = diskSwapReplaySchema.parse({ schemaVersion: 1, snapshots });
  const output = JSON.stringify(replay, null, 2);
  const outputPath = optionValue(args, "--output");
  if (outputPath) {
    await writeFile(resolve(invocationDirectory, outputPath), `${output}\n`, "utf8");
  }
  console.log(output);
}

async function runInspectAdfSet(args: string[]): Promise<void> {
  const inputDirectory = optionValue(args, "--input-dir");
  if (!inputDirectory) throw new Error("inspect-adf-set requires --input-dir <directory>");
  const invocationDirectory = process.env.INIT_CWD ?? process.cwd();
  const resolvedDirectory = resolve(invocationDirectory, inputDirectory);
  const disks = await readAdfSetFiles(resolvedDirectory);
  const expected = parseExpectedDiskCount(args);
  const result = inspectAdfSet(disks, expected);
  console.log(JSON.stringify({ directory: inputDirectory, ...result }, null, 2));
  if (!result.valid) process.exitCode = 1;
}

async function runWriteAdfManifest(args: string[]): Promise<void> {
  const inputDirectory = optionValue(args, "--input-dir");
  const outputPath = optionValue(args, "--output");
  const setId = optionValue(args, "--set-id");
  const title = optionValue(args, "--title");
  const source = optionValue(args, "--source");
  const licenseStatus = optionValue(args, "--license-status");
  if (!inputDirectory || !outputPath || !setId || !title || !source || !licenseStatus) {
    throw new Error("write-adf-manifest requires --input-dir, --output, --set-id, --title, --source, and --license-status");
  }
  const invocationDirectory = process.env.INIT_CWD ?? process.cwd();
  const disks = await readAdfSetFiles(resolve(invocationDirectory, inputDirectory));
  const inspection = inspectAdfSet(disks, parseExpectedDiskCount(args));
  const provenance = adfProvenanceSchema.parse({
    source,
    licenseStatus,
    tool: optionValue(args, "--tool"),
    notes: optionValue(args, "--notes"),
  });
  const manifest = createAdfSetManifest({ setId, title, provenance, inspection });
  await writeFile(
    resolve(invocationDirectory, outputPath),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  console.log(JSON.stringify({ output: outputPath, validation: manifest.validation }, null, 2));
  if (!manifest.validation.valid) process.exitCode = 1;
}

async function readAdfSetFiles(directory: string) {
  const fileNames = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".adf"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  if (fileNames.length === 0) throw new Error("ADF set contains no .adf files");
  return await Promise.all(fileNames.map(async (fileName) => ({
    fileName,
    diskNumber: parseAdfDiskNumber(fileName),
    input: await readFile(resolve(directory, fileName)),
  })));
}

function parseExpectedDiskCount(args: string[]): number | undefined {
  const expectedText = optionValue(args, "--expected-disks");
  if (expectedText === undefined) return undefined;
  if (!/^\d+$/.test(expectedText)) throw new Error("--expected-disks must be a positive integer");
  const expected = Number.parseInt(expectedText, 10);
  if (!Number.isSafeInteger(expected) || expected < 1) {
    throw new Error("--expected-disks must be a positive integer");
  }
  return expected;
}

async function runPreflight(args: string[]): Promise<void> {
  const inputPath = optionValue(args, "--input");
  const manifestPath = optionValue(args, "--manifest");
  if (!inputPath || !manifestPath) {
    throw new Error("preflight requires --input <file> and --manifest <file.json>");
  }
  const invocationDirectory = process.env.INIT_CWD ?? process.cwd();
  const input = decodeHunkInput(await readFile(resolve(invocationDirectory, inputPath)));
  const manifest = fixtureManifestSchema.parse(JSON.parse(
    await readFile(resolve(invocationDirectory, manifestPath), "utf8"),
  ));
  console.log(JSON.stringify(verifyFixtureArtifact(input, manifest), null, 2));
}

async function runReconstruct(args: string[]): Promise<void> {
  const observationsPath = optionValue(args, "--observations");
  if (!observationsPath) throw new Error("reconstruct requires --observations <file.json>");
  const invocationDirectory = process.env.INIT_CWD ?? process.cwd();
  const observations = runtimeObservationSchema.array().parse(JSON.parse(
    await readFile(resolve(invocationDirectory, observationsPath), "utf8"),
  ));
  const staticPath = optionValue(args, "--static");
  const staticSnapshot = staticPath === undefined
    ? undefined
    : staticAnalysisSnapshotSchema.parse(JSON.parse(
      await readFile(resolve(invocationDirectory, staticPath), "utf8"),
    ));
  const analysis = analyzeHorizontalMovement(observations, staticSnapshot);
  const review = reviewHorizontalMovement(analysis.output.selected, observations);
  const metadataPath = optionValue(args, "--metadata");
  const metadata = metadataPath === undefined
    ? undefined
    : JSON.parse(await readFile(resolve(invocationDirectory, metadataPath), "utf8"));
  const ir = analysis.status === "success" && review.status === "success" && analysis.output.selected && metadata
    ? movementCandidateToIR(analysis.output.selected, metadata)
    : null;
  const irOutputPath = optionValue(args, "--ir-output");
  const candidateOutputPath = optionValue(args, "--candidate-output");
  if (candidateOutputPath) {
    if (!analysis.output.selected) throw new Error("reconstruct --candidate-output requires a successful analysis");
    await writeFile(
      resolve(invocationDirectory, candidateOutputPath),
      `${JSON.stringify(analysis.output.selected, null, 2)}\n`,
      "utf8",
    );
  }
  if (irOutputPath) {
    if (!ir) throw new Error("reconstruct --ir-output requires a successful review and --metadata");
    await writeFile(
      resolve(invocationDirectory, irOutputPath),
      `${JSON.stringify(ir, null, 2)}\n`,
      "utf8",
    );
  }
  console.log(JSON.stringify({ analysis, review, ir }, null, 2));
  if (analysis.status !== "success" || review.status !== "success") process.exitCode = 1;
}

async function runGenerate(args: string[]): Promise<void> {
  const irPath = optionValue(args, "--ir");
  if (!irPath) throw new Error("generate requires --ir <file.json>");
  const invocationDirectory = process.env.INIT_CWD ?? process.cwd();
  const ir = JSON.parse(await readFile(resolve(invocationDirectory, irPath), "utf8"));
  process.stdout.write(generateSimulationSource(ir));
}

async function runGrade(args: string[]): Promise<void> {
  const candidatePath = optionValue(args, "--candidate");
  const groundTruthPath = optionValue(args, "--ground-truth");
  if (!candidatePath || !groundTruthPath) {
    throw new Error("grade requires --candidate <file.json> and --ground-truth <file.json>");
  }
  const invocationDirectory = process.env.INIT_CWD ?? process.cwd();
  const candidate = JSON.parse(await readFile(resolve(invocationDirectory, candidatePath), "utf8"));
  const groundTruth = JSON.parse(await readFile(resolve(invocationDirectory, groundTruthPath), "utf8"));
  const result = gradeHorizontalMovement(candidate, groundTruth);
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "success") process.exitCode = 1;
}

async function runAnalyze(args: string[]): Promise<void> {
  const required = (option: string): string => {
    const value = optionValue(args, option);
    if (!value) throw new Error(`analyze requires ${option}`);
    return value;
  };
  const snapshot = await new GhidraHeadlessAdapter(new NodeHeadlessCommandRunner()).analyze({
    analyzeHeadless: required("--analyze-headless"),
    projectDirectory: required("--project-directory"),
    projectName: required("--project-name"),
    inputPath: required("--input"),
    exporterScript: required("--exporter"),
  });
  console.log(JSON.stringify(snapshot, null, 2));
}

async function runCapture(args: string[]): Promise<void> {
  const required = (option: string): string => {
    const value = optionValue(args, option);
    if (!value) throw new Error(`capture requires ${option}`);
    return value;
  };
  const invocationDirectory = process.env.INIT_CWD ?? process.cwd();
  const scenario = runtimeScenarioSchema.parse(JSON.parse(
    await readFile(resolve(invocationDirectory, required("--scenario")), "utf8"),
  ));
  const addresses = required("--addresses").split(",").map((address) => address.trim()).filter(Boolean);
  if (addresses.length === 0) throw new Error("capture requires at least one --addresses value");
  const oracle = new AmiberryRuntimeOracle(new HttpAmiberryTransport(required("--server")));
  await oracle.load(required("--artifact"));
  const observations = await captureScenario(oracle, scenario, addresses);
  const databasePath = optionValue(args, "--database");
  if (databasePath) {
    // Keep SQLite optional for commands that only inspect or analyze inputs.
    const { DatabaseSync, SqliteRuntimeObservationRepository } = await import("@retroport/persistence");
    const database = new DatabaseSync(resolve(invocationDirectory, databasePath));
    try {
      await new SqliteRuntimeObservationRepository(database).save(observations);
    } finally {
      database.close();
    }
  }
  console.log(JSON.stringify(observations, null, 2));
}

async function runExperiment(args: string[]): Promise<void> {
  const required = (option: string): string => {
    const value = optionValue(args, option);
    if (!value) throw new Error(`experiment requires ${option}`);
    return value;
  };
  const addresses = required("--addresses").split(",").map((address) => address.trim()).filter(Boolean);
  if (addresses.length === 0) throw new Error("experiment requires at least one --addresses value");
  const patchedValue = Number(required("--value"));
  if (!Number.isFinite(patchedValue)) throw new Error("experiment requires a finite numeric --value");
  const oracle = new AmiberryRuntimeOracle(new HttpAmiberryTransport(required("--server")));
  await oracle.load(required("--artifact"));
  const result = await runStatePatchExperiment(oracle, {
    field: required("--field"),
    patchedValue,
    input: runtimeInputSchema.parse(required("--input")),
    addresses,
  });
  console.log(JSON.stringify(result, null, 2));
}

function runPhase0(): void {
  const result = runMicroFixturePipeline();
  console.log(JSON.stringify({
    passed: result.passed,
    manifest: result.manifest,
    analysis: result.analysis.status,
    review: result.review.status,
    grade: result.grade?.status ?? "not-run",
    verification: result.verification.map(({ passed }, index) => ({ index, passed })),
  }, null, 2));
  if (!result.passed) process.exitCode = 1;
}

async function runCapturedPhase0(args: string[]): Promise<void> {
  const required = (option: string): string => {
    const value = optionValue(args, option);
    if (!value) throw new Error(`phase0-captured requires ${option}`);
    return value;
  };
  const invocationDirectory = process.env.INIT_CWD ?? process.cwd();
  const readJson = async (option: string): Promise<unknown> =>
    JSON.parse(await readFile(resolve(invocationDirectory, required(option)), "utf8"));

  const scenarios = runtimeScenarioSchema.array().parse(await readJson("--scenarios"));
  const observations = runtimeObservationSchema.array().parse(await readJson("--observations"));
  const initialState = simulationStateSchema.parse(await readJson("--initial-state"));
  const metadata = movementIRMetadataSchema.parse(await readJson("--metadata"));
  const groundTruth = movementGroundTruthSchema.parse(await readJson("--ground-truth"));
  const staticPath = optionValue(args, "--static");
  const staticSnapshot = staticPath === undefined
    ? undefined
    : staticAnalysisSnapshotSchema.parse(JSON.parse(
      await readFile(resolve(invocationDirectory, staticPath), "utf8"),
    ));
  const pipelineInput = {
    artifactId: required("--artifact"),
    scenarios,
    initialState,
    observations,
    metadata,
    groundTruth,
    ...(staticSnapshot === undefined ? {} : { staticSnapshot }),
  };
  const result = runCapturedPhase0Pipeline(pipelineInput);
  console.log(JSON.stringify({
    passed: result.passed,
    manifest: result.manifest,
    analysis: result.analysis.status,
    review: result.review.status,
    grade: result.grade?.status ?? "not-run",
    verification: result.verification.map(({ passed }, index) => ({ index, passed })),
  }, null, 2));
  if (!result.passed) process.exitCode = 1;
}

async function runVerify(args: string[]): Promise<void> {
  const required = (option: string): string => {
    const value = optionValue(args, option);
    if (!value) throw new Error(`verify requires ${option}`);
    return value;
  };
  const readJson = async (option: string): Promise<unknown> => {
    const invocationDirectory = process.env.INIT_CWD ?? process.cwd();
    return JSON.parse(await readFile(resolve(invocationDirectory, required(option)), "utf8"));
  };
  const scenario = runtimeScenarioSchema.parse(await readJson("--scenario"));
  const scenarioId = scenario.id;
  const initialState = simulationStateSchema.parse(await readJson("--initial-state"));
  const ir = horizontalMovementIRSchema.parse(await readJson("--ir"));
  const observations = runtimeObservationSchema.array().parse(await readJson("--observations"));
  const report = verifyScenario(scenarioId, initialState, scenario.inputs, ir, observations);
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
}

function runAcceptance(): void {
  const report = runPhase0AcceptanceSuite({
    tick: { unit: "frame", rateHz: 50 },
    position: { bits: 16, signed: true },
    velocity: { bits: 16, signed: true },
    inputMapping: { left: -2, idle: 0, right: 2 },
    updateOrder: ["read-input", "set-velocity", "apply-velocity"],
  });
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
