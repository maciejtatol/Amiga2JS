import {
  agentResultSchema,
  persistedWorkflowRunSchema,
  workflowAuditEventSchema,
  type AgentResult,
  type PersistedWorkflowRun,
  type WorkflowAuditEvent,
} from "@retroport/schemas";
import type { WorkflowRunRepository } from "./repository.js";
import { validateWorkflowRunHistory } from "./repository.js";
import { z } from "zod";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export interface JsonObject { readonly [key: string]: JsonValue }

export type DeepReadonly<T> = T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export interface WorkflowStepInput<TContext extends JsonObject> {
  readonly context: DeepReadonly<TContext>;
  readonly dependencyInput: JsonObject;
  readonly idempotencyKey?: string;
}

export type WorkflowHandler<TContext extends JsonObject> = (
  input: WorkflowStepInput<TContext>,
) => Promise<AgentResult<unknown>>;

export interface WorkflowStep<TContext extends JsonObject> {
  readonly id: string;
  readonly dependsOn: readonly string[];
  readonly outputSchema: z.ZodType<JsonValue, z.ZodTypeDef, unknown>;
  readonly projectDependencies: (
    dependencies: Readonly<Record<string, DeepReadonly<AgentResult<JsonValue>>>>,
  ) => JsonObject;
  readonly run: WorkflowHandler<TContext>;
}

export interface WorkflowDefinition<TContext extends JsonObject> {
  readonly id: string;
  readonly steps: readonly WorkflowStep<TContext>[];
}
export interface PersistedWorkflowDefinition<TContext extends JsonObject>
  extends WorkflowDefinition<TContext> {
  readonly revision: string;
}

export type WorkflowStepStatus =
  | AgentResult<unknown>["status"]
  | "skipped";

export interface WorkflowStepRecord {
  readonly id: string;
  readonly status: WorkflowStepStatus;
  readonly result?: AgentResult<unknown>;
  readonly blockedBy?: readonly string[];
}

export interface WorkflowRun {
  readonly workflowId: string;
  readonly status: AgentResult<unknown>["status"];
  readonly scheduledOrder: readonly string[];
  readonly executionOrder: readonly string[];
  readonly steps: Readonly<Record<string, WorkflowStepRecord>>;
}

export class InvalidWorkflowError extends Error {
  override readonly name = "InvalidWorkflowError";
}

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(jsonValueSchema),
  z.record(z.string(), jsonValueSchema),
]));
const jsonObjectSchema: z.ZodType<JsonObject> = z.record(z.string(), jsonValueSchema);

export function directDependencyResults(
  dependencies: Readonly<Record<string, DeepReadonly<AgentResult<JsonValue>>>>,
): JsonObject {
  return dependencies as unknown as JsonObject;
}

function stableLayers<TContext extends JsonObject>(
  definition: WorkflowDefinition<TContext>,
): readonly (readonly WorkflowStep<TContext>[])[] {
  if (definition.id.length === 0) {
    throw new InvalidWorkflowError("Workflow ID cannot be empty");
  }
  if (definition.steps.length === 0) {
    throw new InvalidWorkflowError("Workflow must contain at least one step");
  }
  const byId = new Map<string, WorkflowStep<TContext>>();
  for (const step of definition.steps) {
    if (step.id.length === 0) {
      throw new InvalidWorkflowError("Workflow step ID cannot be empty");
    }
    if (byId.has(step.id)) {
      throw new InvalidWorkflowError(`Duplicate workflow step: ${step.id}`);
    }
    byId.set(step.id, step);
  }

  for (const step of definition.steps) {
    for (const dependency of step.dependsOn) {
      if (dependency === step.id) {
        throw new InvalidWorkflowError(`Step ${step.id} cannot depend on itself`);
      }
      if (!byId.has(dependency)) {
        throw new InvalidWorkflowError(
          `Step ${step.id} depends on missing step ${dependency}`,
        );
      }
    }
  }

  const remaining = new Set(byId.keys());
  const completed = new Set<string>();
  const layers: WorkflowStep<TContext>[][] = [];
  while (remaining.size > 0) {
    const ready = [...remaining]
      .filter((id) => byId.get(id)!.dependsOn.every((dependency) => completed.has(dependency)))
      .sort()
      .map((id) => byId.get(id)!);
    if (ready.length === 0) {
      throw new InvalidWorkflowError("Workflow contains a dependency cycle");
    }
    layers.push(ready);
    for (const step of ready) {
      remaining.delete(step.id);
      completed.add(step.id);
    }
  }
  return layers;
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value as DeepReadonly<T>;
  }
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value) as DeepReadonly<T>;
}

function assertJsonSafe(value: unknown, path = "$"): asserts value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return;
    throw new InvalidWorkflowError(`Non-finite number at ${path}`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonSafe(item, `${path}[${index}]`));
    return;
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new InvalidWorkflowError(`Non-JSON object at ${path}`);
    }
    for (const [key, item] of Object.entries(value)) assertJsonSafe(item, `${path}.${key}`);
    return;
  }
  throw new InvalidWorkflowError(`Unsupported JSON value at ${path}`);
}

function failedResult(error: unknown): AgentResult<unknown> {
  return {
    status: "failed",
    output: null,
    evidence: [],
    assumptions: [],
    warnings: [{
      code: "core.workflow.step_exception",
      message: error instanceof Error ? error.message : String(error),
    }],
    confidence: 0,
    nextActions: [],
  };
}

const outcomeOf = (
  records: Readonly<Record<string, WorkflowStepRecord>>,
): WorkflowRun["status"] => {
  const statuses = Object.values(records).map((record) => record.status);
  if (statuses.includes("failed")) return "failed";
  if (statuses.some((value) => value === "blocked" || value === "skipped")) {
    return "blocked";
  }
  return statuses.includes("partial") ? "partial" : "success";
};

export async function runWorkflow<TContext extends JsonObject>(
  definition: WorkflowDefinition<TContext>,
  context: Readonly<TContext>,
): Promise<WorkflowRun> {
  const layers = stableLayers(definition);
  const records: Record<string, WorkflowStepRecord> = {};
  const scheduledOrder: string[] = [];
  const executionOrder: string[] = [];
  let contextSnapshot: DeepReadonly<TContext>;
  try {
    assertJsonSafe(context);
    contextSnapshot = deepFreeze(
      structuredClone(jsonObjectSchema.parse(context)) as TContext,
    );
  } catch (error: unknown) {
    throw new InvalidWorkflowError(
      `Workflow context must be JSON-safe: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  for (const layer of layers) {
    const runnable: WorkflowStep<TContext>[] = [];
    for (const step of layer) {
      scheduledOrder.push(step.id);
      const blockedBy = step.dependsOn.filter((dependency) => {
        const status = records[dependency]?.status;
        return status === "blocked" || status === "failed" || status === "skipped";
      });
      if (blockedBy.length > 0) {
        records[step.id] = { id: step.id, status: "skipped", blockedBy };
      } else {
        runnable.push(step);
        executionOrder.push(step.id);
      }
    }

    const results = await Promise.all(runnable.map(async (step) => {
      try {
        const dependencies = Object.fromEntries(step.dependsOn.map((dependency) => [
          dependency,
          records[dependency]!.result!,
        ])) as Record<string, DeepReadonly<AgentResult<JsonValue>>>;
        const dependencyInput = deepFreeze(jsonObjectSchema.parse(
          step.projectDependencies(deepFreeze(dependencies)),
        ));
        const result = agentResultSchema(step.outputSchema).parse(await step.run({
          context: contextSnapshot,
          dependencyInput,
        })) as AgentResult<JsonValue>;
        assertJsonSafe(result);
        return { step, result };
      } catch (error: unknown) {
        return { step, result: failedResult(error) };
      }
    }));
    for (const { step, result } of results) {
      records[step.id] = { id: step.id, status: result.status, result };
    }
  }

  const status = outcomeOf(records);
  return { workflowId: definition.id, status, scheduledOrder, executionOrder, steps: records };
}

const topologyOf = <T extends JsonObject>(
  layers: readonly (readonly WorkflowStep<T>[])[],
) => layers.flat().map(({ id, dependsOn }) => ({
  id,
  dependsOn: [...dependsOn].sort(),
}));
const sameJson = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);

export async function startPersistedWorkflow<TContext extends JsonObject>(
  definition: PersistedWorkflowDefinition<TContext>,
  context: Readonly<TContext>,
  runId: string,
  repository: WorkflowRunRepository,
): Promise<WorkflowRun> {
  const layers = stableLayers(definition);
  assertJsonSafe(context);
  const snapshot = persistedWorkflowRunSchema.parse({
    schemaVersion: 1,
    runId,
    workflowId: definition.id,
    workflowRevision: definition.revision,
    topology: topologyOf(layers),
    context: structuredClone(context),
    revision: 1,
    running: true,
    completed: false,
    scheduledOrder: [],
    executionOrder: [],
    steps: {},
  });
  await repository.commit(snapshot, [{
    runId,
    sequence: 1,
    revision: 1,
    type: "RUN_CREATED",
    stepIds: [],
  }], null);
  return continuePersisted(definition, snapshot as PersistedWorkflowRun, 1, repository, layers);
}

export async function resumeWorkflow<TContext extends JsonObject>(
  definition: PersistedWorkflowDefinition<TContext>,
  runId: string,
  repository: WorkflowRunRepository,
): Promise<WorkflowRun> {
  const layers = stableLayers(definition);
  const loaded = await repository.load(runId);
  const snapshot = persistedWorkflowRunSchema.parse(loaded.snapshot) as PersistedWorkflowRun;
  const events = workflowAuditEventSchema.array().parse(structuredClone(loaded.events));
  validateWorkflowRunHistory(snapshot, events);
  if (snapshot.workflowId !== definition.id) {
    throw new InvalidWorkflowError("Persisted workflow ID mismatch");
  }
  if (snapshot.workflowRevision !== definition.revision) {
    throw new InvalidWorkflowError("Persisted workflow revision mismatch");
  }
  if (!sameJson(snapshot.topology, topologyOf(layers))) {
    throw new InvalidWorkflowError("Persisted workflow topology mismatch");
  }
  for (const [id, record] of Object.entries(snapshot.steps)) {
    const step = definition.steps.find((candidate) => candidate.id === id);
    if (!step) throw new InvalidWorkflowError(`Unknown persisted step ${id}`);
    if (record.result && record.result.status !== "failed") {
      agentResultSchema(step.outputSchema).parse(record.result);
    }
  }
  if (snapshot.completed) return persistedToRun(snapshot);
  return continuePersisted(definition, snapshot, events.length, repository, layers);
}

const persistedToRun = (snapshot: PersistedWorkflowRun): WorkflowRun => ({
  workflowId: snapshot.workflowId, status: snapshot.outcome ?? "failed",
  scheduledOrder: snapshot.scheduledOrder, executionOrder: snapshot.executionOrder,
  steps: snapshot.steps as Record<string, WorkflowStepRecord>,
});

async function continuePersisted<TContext extends JsonObject>(
  definition: PersistedWorkflowDefinition<TContext>,
  initial: PersistedWorkflowRun,
  initialEventCount: number,
  repository: WorkflowRunRepository,
  layers: readonly (readonly WorkflowStep<TContext>[])[],
): Promise<WorkflowRun> {
  let snapshot = initial;
  let eventCount = initialEventCount;
  const context = deepFreeze(structuredClone(snapshot.context) as TContext);
  for (const layer of layers) {
    if (layer.every((step) => snapshot.steps[step.id] !== undefined)) continue;
    const records = structuredClone(snapshot.steps) as Record<string, WorkflowStepRecord>;
    const scheduled = [...snapshot.scheduledOrder];
    const executed = [...snapshot.executionOrder];
    const runnable: WorkflowStep<TContext>[] = [];
    for (const step of layer) {
      if (records[step.id]) continue;
      scheduled.push(step.id);
      const blockedBy = step.dependsOn.filter((id) =>
        ["failed", "blocked", "skipped"].includes(records[id]?.status ?? ""),
      );
      if (blockedBy.length) {
        records[step.id] = { id: step.id, status: "skipped", blockedBy };
      } else {
        runnable.push(step);
        executed.push(step.id);
      }
    }
    const results = await Promise.all(runnable.map(async (step) => {
      try {
        const dependencies = Object.fromEntries(
          step.dependsOn.map((id) => [id, records[id]!.result!]),
        ) as Record<string, DeepReadonly<AgentResult<JsonValue>>>;
        const dependencyInput = deepFreeze(jsonObjectSchema.parse(
          step.projectDependencies(deepFreeze(dependencies)),
        ));
        const result = agentResultSchema(step.outputSchema).parse(await step.run({
          context,
          dependencyInput,
          idempotencyKey: `${snapshot.runId}:${snapshot.workflowRevision}:${step.id}`,
        })) as AgentResult<JsonValue>;
        assertJsonSafe(result);
        return { step, result };
      } catch (error) {
        return { step, result: failedResult(error) };
      }
    }));
    for (const { step, result } of results) records[step.id] = { id: step.id, status: result.status, result };
    const isLast = layer === layers.at(-1);
    const revision = snapshot.revision + 1;
    const outcome = isLast ? outcomeOf(records) : undefined;
    const next = persistedWorkflowRunSchema.parse({
      ...snapshot,
      revision,
      steps: records,
      scheduledOrder: scheduled,
      executionOrder: executed,
      running: !isLast,
      completed: isLast,
      ...(outcome ? { outcome } : {}),
    }) as PersistedWorkflowRun;
    const events: WorkflowAuditEvent[] = [{
      runId: snapshot.runId,
      sequence: ++eventCount,
      revision,
      type: "LAYER_COMPLETED",
      stepIds: layer.map(({ id }) => id),
    }];
    if (isLast) {
      events.push({
        runId: snapshot.runId,
        sequence: ++eventCount,
        revision,
        type: "RUN_COMPLETED",
        stepIds: [],
      });
    }
    await repository.commit(next, events, snapshot.revision);
    snapshot = next;
  }
  return persistedToRun(snapshot);
}
