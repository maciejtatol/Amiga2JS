#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { diagnoseProject, loadCompatibilityRules } from "@retroport/compatibility";
import { projectManifestSchema } from "@retroport/schemas";

function optionValue(args: string[], option: string): string | undefined {
  const index = args.indexOf(option);
  return index === -1 ? undefined : args[index + 1];
}

async function run(): Promise<void> {
  const [, , command, ...args] = process.argv;
  if (command !== "doctor") {
    throw new Error("Usage: retroport doctor --manifest <file.json> --rules <directory>");
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

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
