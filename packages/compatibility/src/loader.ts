import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { compatibilityRuleSchema, type CompatibilityRule } from "@retroport/schemas";
import { parse } from "yaml";

export async function loadCompatibilityRules(directory: string): Promise<CompatibilityRule[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && [".yaml", ".yml"].includes(extname(entry.name)))
    .map((entry) => entry.name)
    .sort();

  return Promise.all(files.map(async (file) => {
    const contents = await readFile(join(directory, file), "utf8");
    return compatibilityRuleSchema.parse(parse(contents));
  }));
}
