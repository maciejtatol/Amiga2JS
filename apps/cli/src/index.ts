#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { diagnoseProject, loadCompatibilityRules } from "@retroport/compatibility";
import { projectManifestSchema } from "@retroport/schemas";
import { captureScenario, HttpAmiberryTransport, runtimeScenarioSchema, AmiberryRuntimeOracle } from "@retroport/runtime-amiberry";
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
  if (command !== "doctor") {
    throw new Error("Usage: retroport doctor ... | retroport analyze ... | retroport capture ...");
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

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
