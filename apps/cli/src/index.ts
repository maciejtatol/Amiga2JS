#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { diagnoseProject, loadCompatibilityRules } from "@retroport/compatibility";
import { projectManifestSchema } from "@retroport/schemas";
import {
  captureScenario,
  HttpAmiberryTransport,
  runtimeObservationSchema,
  runtimeScenarioSchema,
  AmiberryRuntimeOracle,
} from "@retroport/runtime-amiberry";
import { runPhase0AcceptanceSuite, verifyScenario } from "@retroport/verification";
import { horizontalMovementIRSchema } from "@retroport/schemas";
import { simulationStateSchema } from "@retroport/target-typescript";
import { GhidraHeadlessAdapter, NodeHeadlessCommandRunner } from "@retroport/static-analysis";

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
  if (command === "capture") {
    await runCapture(args);
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
    throw new Error("Usage: retroport doctor ... | retroport analyze ... | retroport capture ... | retroport verify ... | retroport acceptance");
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
  console.log(JSON.stringify(observations, null, 2));
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
