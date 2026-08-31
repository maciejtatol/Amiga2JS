import {
  persistedWorkflowRunSchema, workflowAuditEventSchema,
  type PersistedWorkflowRun, type WorkflowAuditEvent,
} from "@retroport/schemas";

export class WorkflowRunRepositoryError extends Error {
  override name = "WorkflowRunRepositoryError";
}
export class WorkflowRunNotFoundError extends WorkflowRunRepositoryError {
  override name = "WorkflowRunNotFoundError";
}
export class WorkflowRunAlreadyExistsError extends WorkflowRunRepositoryError {
  override name = "WorkflowRunAlreadyExistsError";
}
export class WorkflowRunRevisionError extends WorkflowRunRepositoryError {
  override name = "WorkflowRunRevisionError";
}

export interface WorkflowRunRepository {
  load(runId: string): Promise<{ snapshot: PersistedWorkflowRun; events: readonly WorkflowAuditEvent[] }>;
  commit(snapshot: PersistedWorkflowRun, events: readonly WorkflowAuditEvent[], expectedRevision: number | null): Promise<void>;
}

const cloneSnapshot = (value: unknown): PersistedWorkflowRun =>
  persistedWorkflowRunSchema.parse(structuredClone(value));
const cloneEvents = (value: unknown): WorkflowAuditEvent[] =>
  workflowAuditEventSchema.array().parse(structuredClone(value));
const equal = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);
const layersOf = (topology: PersistedWorkflowRun["topology"]): string[][] => {
  const remaining = new Map(topology.map((step) => [step.id, step.dependsOn]));
  const done = new Set<string>();
  const layers: string[][] = [];
  while (remaining.size) {
    const ready = [...remaining]
      .filter(([, dependencies]) => dependencies.every((id) => done.has(id)))
      .map(([id]) => id)
      .sort();
    if (!ready.length) {
      throw new WorkflowRunRevisionError(
        "Persisted topology is cyclic or has missing dependencies",
      );
    }
    layers.push(ready);
    ready.forEach((id) => {
      remaining.delete(id);
      done.add(id);
    });
  }
  return layers;
};

export function validateWorkflowRunHistory(
  snapshot: PersistedWorkflowRun,
  events: readonly WorkflowAuditEvent[],
): void {
  const layers = layersOf(snapshot.topology);
  const layerEvents = events.filter(({ type }) => type === "LAYER_COMPLETED");
  if (
    !events.length
    || events[0]?.type !== "RUN_CREATED"
    || events[0]?.revision !== 1
    || events[0].stepIds.length !== 0
  ) {
    throw new WorkflowRunRevisionError("History must begin with an empty RUN_CREATED event");
  }
  events.forEach((event, index) => {
    if (event.runId !== snapshot.runId || event.sequence !== index + 1) {
      throw new WorkflowRunRevisionError("Invalid audit identity or sequence");
    }
  });
  if (layerEvents.length > layers.length || layerEvents.some((event, index) => !equal(event.stepIds, layers[index]))) throw new WorkflowRunRevisionError("Audit layers must be an exact topology prefix");
  const expectedScheduled = layers.slice(0, layerEvents.length).flat();
  if (!equal(snapshot.scheduledOrder, expectedScheduled)) throw new WorkflowRunRevisionError("Scheduled order must be an exact completed-layer prefix");
  const expectedExecuted = expectedScheduled.filter((id) => snapshot.steps[id]?.status !== "skipped");
  if (!equal(snapshot.executionOrder, expectedExecuted)) throw new WorkflowRunRevisionError("Execution order is inconsistent with step records");
  const expectedRevision = layerEvents.length + 1;
  if (snapshot.revision !== expectedRevision || layerEvents.some((event, index) => event.revision !== index + 2)) throw new WorkflowRunRevisionError("Audit revisions must match checkpoints");
  const completedEvents = events.filter(({ type }) => type === "RUN_COMPLETED");
  if (snapshot.completed !== (completedEvents.length === 1) || (completedEvents[0] && completedEvents[0] !== events.at(-1))) throw new WorkflowRunRevisionError("Invalid terminal audit event");
  if (completedEvents[0] && (completedEvents[0].revision !== snapshot.revision || completedEvents[0].stepIds.length !== 0)) throw new WorkflowRunRevisionError("Invalid RUN_COMPLETED payload");
  if (snapshot.completed && layerEvents.length !== layers.length) throw new WorkflowRunRevisionError("Terminal history must contain every layer");
  if (events.some(({ type }, index) => type === "RUN_CREATED" && index !== 0)) throw new WorkflowRunRevisionError("RUN_CREATED may occur only once");
  for (const step of snapshot.topology) {
    const record = snapshot.steps[step.id]; if (!record) continue;
    if (record.status === "skipped" && !record.blockedBy?.every((id) => step.dependsOn.includes(id) && ["failed", "blocked", "skipped"].includes(snapshot.steps[id]?.status ?? ""))) throw new WorkflowRunRevisionError("Invalid blockedBy relationship");
  }
  if (snapshot.completed) {
    const statuses = Object.values(snapshot.steps).map(({ status }) => status);
    const outcome = statuses.includes("failed") ? "failed" : statuses.some((s) => s === "blocked" || s === "skipped") ? "blocked" : statuses.includes("partial") ? "partial" : "success";
    if (snapshot.outcome !== outcome) throw new WorkflowRunRevisionError("Stored outcome does not match step records");
  }
}

export class InMemoryWorkflowRunRepository implements WorkflowRunRepository {
  readonly #runs = new Map<string, { snapshot: PersistedWorkflowRun; events: WorkflowAuditEvent[] }>();

  async load(runId: string) {
    const value = this.#runs.get(runId);
    if (!value) throw new WorkflowRunNotFoundError(`Workflow run not found: ${runId}`);
    const snapshot = cloneSnapshot(value.snapshot); const events = cloneEvents(value.events);
    validateWorkflowRunHistory(snapshot, events);
    return { snapshot, events };
  }

  async commit(snapshotInput: PersistedWorkflowRun, eventsInput: readonly WorkflowAuditEvent[], expectedRevision: number | null) {
    const snapshot = cloneSnapshot(snapshotInput);
    const events = cloneEvents(eventsInput);
    const current = this.#runs.get(snapshot.runId);
    if (events.length === 0) throw new WorkflowRunRevisionError("Each commit requires at least one audit event");
    if (expectedRevision === null) {
      if (current) throw new WorkflowRunAlreadyExistsError(`Workflow run already exists: ${snapshot.runId}`);
      if (snapshot.revision !== 1) throw new WorkflowRunRevisionError("Initial revision must be 1");
      if (events.length !== 1 || events[0]?.type !== "RUN_CREATED") throw new WorkflowRunRevisionError("Initial commit requires RUN_CREATED");
    } else {
      if (!current) throw new WorkflowRunNotFoundError(`Workflow run not found: ${snapshot.runId}`);
      if (current.snapshot.revision !== expectedRevision || snapshot.revision !== expectedRevision + 1) {
        throw new WorkflowRunRevisionError(`Expected revision ${expectedRevision}`);
      }
      if (snapshot.workflowId !== current.snapshot.workflowId || snapshot.workflowRevision !== current.snapshot.workflowRevision || !equal(snapshot.topology, current.snapshot.topology) || !equal(snapshot.context, current.snapshot.context)) throw new WorkflowRunRevisionError("Persisted workflow identity, topology, and context are immutable");
      for (const [id, record] of Object.entries(current.snapshot.steps)) if (!equal(snapshot.steps[id], record)) throw new WorkflowRunRevisionError(`Committed step cannot change: ${id}`);
    }
    const priorEvents = current?.events ?? [];
    events.forEach((event, index) => {
      const sequence = priorEvents.length + index + 1;
      if (event.runId !== snapshot.runId || event.sequence !== sequence || event.revision !== snapshot.revision) {
        throw new WorkflowRunRevisionError("Audit events must have contiguous sequence and current revision");
      }
    });
    if (expectedRevision !== null && events[0]?.type !== "LAYER_COMPLETED") throw new WorkflowRunRevisionError("Checkpoint requires LAYER_COMPLETED");
    if (snapshot.completed !== events.some(({ type }) => type === "RUN_COMPLETED")) throw new WorkflowRunRevisionError("Terminal event and snapshot must agree");
    const history = [...priorEvents, ...events];
    validateWorkflowRunHistory(snapshot, history);
    this.#runs.set(snapshot.runId, { snapshot, events: history });
  }
}
