import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { diagnoseProject, loadCompatibilityRules } from "../src/index.js";

const manifest = {
  id: "fixture",
  name: "MicroFixture",
  source: { platform: "amiga", format: "hunk", cpu: "m68000" },
  features: ["self-modifying-code"],
};

describe("compatibility registry", () => {
  it("loads and validates YAML rules deterministically", async () => {
    const directory = await mkdtemp(join(tmpdir(), "retroport-rules-"));
    await writeFile(join(directory, "rule.yaml"), `id: amiga.memory.self_modifying
severity: high
category: static-analysis
classification: REQUIRES_MANUAL_RE
match:
  all:
    - path: features
      operator: includes
      value: self-modifying-code
message: Self-modifying code detected.
impact: Static analysis may not represent executed code.
recommendation:
  - Capture runtime code.
capabilities:
  static_analysis: degraded
`);
    const rules = await loadCompatibilityRules(directory);
    expect(rules).toHaveLength(1);
    expect(diagnoseProject(manifest, rules)).toEqual({
      classification: "REQUIRES_MANUAL_RE",
      capabilities: { static_analysis: "degraded" },
      warningIds: ["amiga.memory.self_modifying"],
    });
  });

  it("reports supported when no rule matches", () => {
    expect(diagnoseProject(manifest, [])).toEqual({
      classification: "SUPPORTED",
      capabilities: {},
      warningIds: [],
    });
  });
});
