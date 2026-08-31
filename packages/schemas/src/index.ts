import { z } from "zod";

export const supportClassificationSchema = z.enum([
  "SUPPORTED", "SUPPORTED_WITH_WARNINGS", "PARTIAL", "REQUIRES_MANUAL_RE",
  "REQUIRES_HARDWARE_EMULATION", "UNSUPPORTED", "UNKNOWN",
]);
export type SupportClassification = z.infer<typeof supportClassificationSchema>;

export const projectManifestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  source: z.object({
    platform: z.string().min(1),
    format: z.string().min(1),
    cpu: z.string().min(1),
  }),
  features: z.array(z.string()).default([]),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type ProjectManifest = z.infer<typeof projectManifestSchema>;

export const capabilityMatrixSchema = z.object({
  classification: supportClassificationSchema,
  capabilities: z.record(
    z.string(),
    z.enum(["available", "degraded", "unavailable", "unknown"]),
  ),
  warningIds: z.array(z.string()),
});
export type CapabilityMatrix = z.infer<typeof capabilityMatrixSchema>;

export const ruleConditionSchema = z.object({
  path: z.string().min(1),
  operator: z.enum(["equals", "not_equals", "includes", "exists"]),
  value: z.unknown().optional(),
});
export type RuleCondition = z.infer<typeof ruleConditionSchema>;

export const compatibilityRuleSchema = z.object({
  id: z.string().min(1),
  severity: z.enum(["info", "low", "medium", "high", "critical"]),
  category: z.string().min(1),
  classification: supportClassificationSchema,
  match: z.object({ all: z.array(ruleConditionSchema).min(1) }),
  message: z.string().min(1),
  impact: z.string().min(1),
  recommendation: z.array(z.string().min(1)).default([]),
  capabilities: z.record(
    z.string(),
    z.enum(["available", "degraded", "unavailable", "unknown"]),
  ).default({}),
});
export type CompatibilityRule = z.infer<typeof compatibilityRuleSchema>;
export type CompatibilityWarning = CompatibilityRule;

export const assertionStatusSchema = z.enum([
  "OBSERVED", "DERIVED", "HYPOTHESIS", "VERIFIED", "REJECTED", "UNKNOWN",
]);

export const evidenceRecordSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  status: assertionStatusSchema,
  summary: z.string().min(1),
  provenance: z.object({
    source: z.string().min(1),
    artifactId: z.string().optional(),
    tool: z.string().optional(),
  }),
  createdAt: z.string().datetime(),
});
export type EvidenceRecord = z.infer<typeof evidenceRecordSchema>;

export const assumptionSchema = z.object({
  description: z.string().min(1),
  risk: z.enum(["low", "medium", "high"]),
});
export const warningSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
});
export const nextActionSchema = z.object({
  description: z.string().min(1),
  priority: z.enum(["low", "medium", "high"]),
});

export const agentResultSchema = <T extends z.ZodTypeAny>(outputSchema: T) =>
  z.object({
    status: z.enum(["success", "partial", "blocked", "failed"]),
    output: outputSchema,
    evidence: z.array(z.string()),
    assumptions: z.array(assumptionSchema),
    warnings: z.array(warningSchema),
    confidence: z.number().min(0).max(1),
    nextActions: z.array(nextActionSchema),
  });
export interface AgentResult<T> {
  status: "success" | "partial" | "blocked" | "failed";
  output: T;
  evidence: string[];
  assumptions: z.infer<typeof assumptionSchema>[];
  warnings: z.infer<typeof warningSchema>[];
  confidence: number;
  nextActions: z.infer<typeof nextActionSchema>[];
}

export const hypothesisSchema = z.object({
  id: z.string().min(1),
  claim: z.string().min(1),
  status: z.enum(["CANDIDATE", "HYPOTHESIS", "SUPPORTED", "VERIFIED", "REJECTED"]),
  evidenceIds: z.array(z.string()),
  falsifiablePredictions: z.array(z.string().min(1)),
  confidence: z.number().min(0).max(1),
});
export type Hypothesis = z.infer<typeof hypothesisSchema>;

export const experimentSchema = z.object({
  id: z.string().min(1),
  hypothesisId: z.string().min(1),
  status: z.enum(["planned", "running", "passed", "failed", "inconclusive"]),
  procedure: z.array(z.string().min(1)).min(1),
  expectedObservations: z.array(z.string().min(1)).min(1),
  evidenceIds: z.array(z.string()),
});
export type Experiment = z.infer<typeof experimentSchema>;

export const evidenceChannelSchema = z.enum([
  "static-analysis",
  "dynamic-trace",
  "controlled-experiment",
  "source-artifact",
  "manual-observation",
]);
export type EvidenceChannel = z.infer<typeof evidenceChannelSchema>;

export const producerIdentitySchema = z.object({
  actorId: z.string().min(1),
  role: z.enum(["analyst", "reviewer", "experimenter", "verifier", "tool"]),
}).strict();

export const lifecycleEvidenceRecordSchema = z.object({
  id: z.string().min(1),
  channel: evidenceChannelSchema,
  producer: producerIdentitySchema,
  summary: z.string().min(1),
}).strict();
export type LifecycleEvidenceRecord = z.infer<typeof lifecycleEvidenceRecordSchema>;

export const semanticLifecycleStatusSchema = z.enum([
  "UNKNOWN", "CANDIDATE", "HYPOTHESIS", "SUPPORTED", "VERIFIED", "REJECTED",
]);
export type SemanticLifecycleStatus = z.infer<typeof semanticLifecycleStatusSchema>;

export const semanticAssertionSchema = z.object({
  id: z.string().min(1),
  claim: z.string().min(1),
  analystId: z.string().min(1),
  evidenceIds: z.array(z.string().min(1)),
  predictions: z.array(z.string().min(1)),
}).strict();
export type SemanticAssertion = z.infer<typeof semanticAssertionSchema>;

export const lifecycleExperimentSchema = z.object({
  id: z.string().min(1),
  assertionId: z.string().min(1),
  producer: producerIdentitySchema,
  status: z.enum(["planned", "running", "passed", "failed", "inconclusive"]),
  outcome: z.enum(["supporting", "rejecting", "inconclusive"]),
  deterministic: z.boolean(),
  testedPredictions: z.array(z.string().min(1)).min(1),
  evidenceIds: z.array(z.string().min(1)).min(1),
}).strict();
export type LifecycleExperiment = z.infer<typeof lifecycleExperimentSchema>;

export const evidenceLifecycleInputSchema = z.object({
  assertions: z.array(semanticAssertionSchema),
  evidence: z.array(lifecycleEvidenceRecordSchema),
  experiments: z.array(lifecycleExperimentSchema),
}).strict();

export const lifecycleReasonSchema = z.object({
  code: z.enum([
    "DUPLICATE_ASSERTION_ID", "DUPLICATE_EVIDENCE_ID", "DUPLICATE_EXPERIMENT_ID",
    "MISSING_EVIDENCE", "MISSING_ASSERTION", "MISSING_PREDICTIONS",
    "INSUFFICIENT_CHANNELS", "NO_INDEPENDENT_DETERMINISTIC_SUPPORT",
  ]),
  referenceId: z.string().min(1),
  message: z.string().min(1),
}).strict();
export type LifecycleReason = z.infer<typeof lifecycleReasonSchema>;

export const assertionAssessmentSchema = z.object({
  assertionId: z.string().min(1),
  status: semanticLifecycleStatusSchema,
  channels: z.array(evidenceChannelSchema),
  reasons: z.array(lifecycleReasonSchema),
}).strict();

const generationGateDecisionFields = {
  assertionIds: z.array(z.string().min(1)),
  assessments: z.array(assertionAssessmentSchema),
  reasons: z.array(lifecycleReasonSchema),
};
const gateCodeUnitSort = (values: readonly string[]): string[] =>
  [...values].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
export const generationGateAllowDecisionSchema = z.object({
  decision: z.literal("allow"),
  faithfulGeneration: z.literal(true),
  assertionIds: generationGateDecisionFields.assertionIds.min(1),
  assessments: generationGateDecisionFields.assessments.min(1).refine(
    (items) => items.every(({ status }) => status === "SUPPORTED" || status === "VERIFIED"),
    "Allow decisions require every assertion to be supported or verified",
  ),
  reasons: generationGateDecisionFields.reasons.max(0),
}).strict().superRefine((decision, context) => {
  const assertionIds = gateCodeUnitSort(decision.assertionIds);
  const assessmentIds = gateCodeUnitSort(decision.assessments.map(({ assertionId }) => assertionId));
  const invalid = new Set(decision.assessments.flatMap((assessment) => [
    ...(new Set(assessment.channels).size < 2 ? ["Each allowed assessment requires at least two unique channels"] : []),
    ...(assessment.reasons.length > 0 ? ["Allowed assessments cannot contain reasons"] : []),
  ]));
  if (new Set(assertionIds).size !== assertionIds.length) invalid.add("assertionIds must be unique");
  if (new Set(assessmentIds).size !== assessmentIds.length) invalid.add("Assessment assertion IDs must be unique");
  if (assertionIds.join("\u0000") !== assessmentIds.join("\u0000")) invalid.add("assertionIds and assessment IDs must match exactly");
  for (const message of invalid) context.addIssue({ code: z.ZodIssueCode.custom, message });
});
export const generationGateBlockDecisionSchema = z.object({
  decision: z.literal("block"),
  faithfulGeneration: z.literal(false),
  ...generationGateDecisionFields,
}).strict();
export const generationGateDecisionSchema = z.union([
  generationGateAllowDecisionSchema,
  generationGateBlockDecisionSchema,
]);
export type GenerationGateDecision = z.infer<typeof generationGateDecisionSchema>;

export const horizontalMovementIRSchema = z.object({
  tick: z.object({ unit: z.literal("frame"), rateHz: z.number().positive() }),
  position: z.object({ bits: z.literal(16), signed: z.literal(true) }),
  velocity: z.object({ bits: z.literal(16), signed: z.literal(true) }),
  inputMapping: z.object({
    left: z.number().int(), idle: z.number().int(), right: z.number().int(),
  }),
  updateOrder: z.tuple([
    z.literal("read-input"), z.literal("set-velocity"), z.literal("apply-velocity"),
  ]),
});
export type HorizontalMovementIR = z.infer<typeof horizontalMovementIRSchema>;
