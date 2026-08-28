import { agentResultSchema, type AgentResult } from "@retroport/schemas";
import { z } from "zod";

export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export interface WorkflowStepInput<TContext> {
  readonly context: DeepReadonly<TContext>;
  readonly dependencies: Readonly<Record<string, DeepReadonly<AgentResult<unknown>>>>;
}

export type WorkflowHandler<TContext> = (
  input: WorkflowStepInput<TContext>,
) => Promise<AgentResult<unknown>>;

export interface WorkflowStep<TContext> {
  readonly id: string;
  readonly dependsOn: readonly string[];
  readonly run: WorkflowHandler<TContext>;
}

export interface WorkflowDefinition<TContext> {
  readonly id: string;
  readonly steps: readonly WorkflowStep<TContext>[];
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

function stableLayers<TContext>(
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

export async function runWorkflow<TContext>(
  definition: WorkflowDefinition<TContext>,
  context: Readonly<TContext>,
): Promise<WorkflowRun> {
  const layers = stableLayers(definition);
  const records: Record<string, WorkflowStepRecord> = {};
  const scheduledOrder: string[] = [];
  const executionOrder: string[] = [];
  const contextSnapshot = deepFreeze(structuredClone(context));

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
        ]));
        const result = agentResultSchema(z.unknown()).parse(await step.run({
          context: contextSnapshot,
          dependencies: deepFreeze(dependencies),
        })) as AgentResult<unknown>;
        return { step, result };
      } catch (error: unknown) {
        return { step, result: failedResult(error) };
      }
    }));
    for (const { step, result } of results) {
      records[step.id] = { id: step.id, status: result.status, result };
    }
  }

  const statuses = Object.values(records).map((record) => record.status);
  const status = statuses.includes("failed")
    ? "failed"
    : statuses.some((value) => value === "blocked" || value === "skipped")
      ? "blocked"
      : statuses.includes("partial") ? "partial" : "success";
  return { workflowId: definition.id, status, scheduledOrder, executionOrder, steps: records };
}
