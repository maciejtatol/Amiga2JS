import {
  capabilityMatrixSchema,
  type CapabilityMatrix,
  type CompatibilityRule,
  type ProjectManifest,
  type RuleCondition,
  type SupportClassification,
} from "@retroport/schemas";

const classificationRank: Record<SupportClassification, number> = {
  SUPPORTED: 0,
  SUPPORTED_WITH_WARNINGS: 1,
  UNKNOWN: 2,
  PARTIAL: 3,
  REQUIRES_MANUAL_RE: 4,
  REQUIRES_HARDWARE_EMULATION: 5,
  UNSUPPORTED: 6,
};

function readPath(input: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((value, segment) => {
    if (typeof value !== "object" || value === null || !(segment in value)) return undefined;
    return (value as Record<string, unknown>)[segment];
  }, input);
}

function conditionMatches(manifest: ProjectManifest, condition: RuleCondition): boolean {
  const actual = readPath(manifest, condition.path);
  switch (condition.operator) {
    case "equals": return actual === condition.value;
    case "not_equals": return actual !== condition.value;
    case "includes": return Array.isArray(actual) && actual.includes(condition.value);
    case "exists": return (actual !== undefined) === (condition.value ?? true);
  }
}

export function diagnoseProject(
  manifest: ProjectManifest,
  rules: CompatibilityRule[],
): CapabilityMatrix {
  const matched = rules.filter((rule) =>
    rule.match.all.every((condition) => conditionMatches(manifest, condition)),
  );
  const classification = matched.reduce<SupportClassification>(
    (current, rule) => classificationRank[rule.classification] > classificationRank[current]
      ? rule.classification
      : current,
    "SUPPORTED",
  );
  const capabilities = Object.assign({}, ...matched.map((rule) => rule.capabilities));
  return capabilityMatrixSchema.parse({
    classification,
    capabilities,
    warningIds: matched.map((rule) => rule.id),
  });
}
