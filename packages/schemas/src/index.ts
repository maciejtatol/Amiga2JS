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
