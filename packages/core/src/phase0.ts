import type { AgentResult } from "@retroport/schemas";
import { z } from "zod";
import {
  directDependencyResults,
  type DeepReadonly,
  type JsonObject,
  type JsonValue,
  type WorkflowDefinition,
  type WorkflowHandler,
} from "./workflow.js";

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
export interface Phase0StepImplementation<TContext extends JsonObject> {
  readonly run: WorkflowHandler<TContext>;
  readonly outputSchema: z.ZodType<JsonValue, z.ZodTypeDef, unknown>;
}
export type Phase0Handlers<TContext extends JsonObject> = Record<
  Phase0StepId,
  Phase0StepImplementation<TContext>
>;

export const semanticAnalysisOutputSchema = z.object({
  claim: z.string().min(1),
  evidenceIds: z.array(z.string().min(1)),
  addresses: z.array(z.string()).default([]),
  traceIds: z.array(z.string()).default([]),
  reproducibleExperiments: z.array(z.string()).default([]),
  analystNarrative: z.string().nullable().default(null),
}).strict();
export type SemanticAnalysisOutput = z.infer<typeof semanticAnalysisOutputSchema>;

export const skepticalReviewerInputSchema = semanticAnalysisOutputSchema.omit({
  analystNarrative: true,
});
export type SkepticalReviewerInput = z.infer<typeof skepticalReviewerInputSchema>;

export function projectSkepticalReviewerInput(
  dependencies: Readonly<Record<string, DeepReadonly<AgentResult<JsonValue>>>>,
): JsonObject {
  const analysis = semanticAnalysisOutputSchema.parse(
    dependencies["semantic-analysis"]?.output,
  );
  const { analystNarrative: _privateNarrative, ...reviewerInput } = analysis;
  return skepticalReviewerInputSchema.parse(reviewerInput);
}

export function createPhase0Workflow<TContext extends JsonObject>(
  handlers: Phase0Handlers<TContext>,
): WorkflowDefinition<TContext> {
  const step = (id: Phase0StepId, dependsOn: readonly Phase0StepId[]) => ({
    id,
    dependsOn,
    outputSchema: id === "semantic-analysis"
      ? semanticAnalysisOutputSchema
      : handlers[id].outputSchema,
    projectDependencies: id === "skeptical-review"
      ? projectSkepticalReviewerInput
      : directDependencyResults,
    run: handlers[id].run,
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
