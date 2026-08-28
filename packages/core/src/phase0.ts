import type { WorkflowDefinition, WorkflowHandler } from "./workflow.js";

export const phase0StepIds = [
  "inspect-input",
  "check-compatibility",
  "check-legal-boundary",
  "triage-gate",
  "static-discovery",
  "dynamic-discovery",
  "semantic-analysis",
  "skeptical-review",
  "design-experiment",
  "run-experiment",
  "evidence-gate",
  "emit-semantic-ir",
  "generate-target",
  "code-review",
  "behavioral-verification",
  "determinism-verification",
  "acceptance-gate",
] as const;

export type Phase0StepId = (typeof phase0StepIds)[number];
export type Phase0Handlers<TContext> = Record<Phase0StepId, WorkflowHandler<TContext>>;

export function createPhase0Workflow<TContext>(
  handlers: Phase0Handlers<TContext>,
): WorkflowDefinition<TContext> {
  const step = (id: Phase0StepId, dependsOn: readonly Phase0StepId[]) => ({
    id,
    dependsOn,
    run: handlers[id],
  });
  return {
    id: "amiga-m68k-horizontal-v0.1",
    steps: [
      step("inspect-input", []),
      step("check-compatibility", []),
      step("check-legal-boundary", []),
      step("triage-gate", ["inspect-input", "check-compatibility", "check-legal-boundary"]),
      step("static-discovery", ["triage-gate"]),
      step("dynamic-discovery", ["triage-gate"]),
      step("semantic-analysis", ["static-discovery", "dynamic-discovery"]),
      step("skeptical-review", ["semantic-analysis"]),
      step("design-experiment", ["skeptical-review"]),
      step("run-experiment", ["design-experiment"]),
      step("evidence-gate", [
        "static-discovery",
        "dynamic-discovery",
        "skeptical-review",
        "run-experiment",
      ]),
      step("emit-semantic-ir", ["evidence-gate"]),
      step("generate-target", ["emit-semantic-ir"]),
      step("code-review", ["generate-target"]),
      step("behavioral-verification", ["code-review"]),
      step("determinism-verification", ["code-review"]),
      step("acceptance-gate", ["behavioral-verification", "determinism-verification"]),
    ],
  };
}
