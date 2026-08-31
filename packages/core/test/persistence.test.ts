import type { AgentResult } from "@retroport/schemas";
import { persistedWorkflowRunSchema } from "@retroport/schemas";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  InMemoryWorkflowRunRepository, InvalidWorkflowError,
  directDependencyResults, resumeWorkflow, startPersistedWorkflow,
  type PersistedWorkflowDefinition, type WorkflowRunRepository,
} from "../src/index.js";

const ok = (): AgentResult<null> => ({ status: "success", output: null, evidence: [], assumptions: [], warnings: [], confidence: 1, nextActions: [] });
const workflow = (calls: string[], revision = "rev-1"): PersistedWorkflowDefinition<Record<string, never>> => ({
  id: "persisted", revision, steps: ["b", "a", "join"].map((id) => ({
    id, dependsOn: id === "join" ? ["a", "b"] : [], outputSchema: z.null(), projectDependencies: directDependencyResults,
    run: vi.fn(async ({ idempotencyKey }) => { calls.push(`${id}:${idempotencyKey}`); return ok(); }),
  })),
});

describe("persisted workflows", () => {
  it("allows exactly one valid concurrent CAS checkpoint", async () => {
    const repo = new InMemoryWorkflowRunRepository();
    const initial = persistedWorkflowRunSchema.parse({ schemaVersion: 1, runId: "cas", workflowId: "w", workflowRevision: "r", topology: [{ id: "root", dependsOn: [] }], context: {}, revision: 1, running: true, completed: false, scheduledOrder: [], executionOrder: [], steps: {} });
    await repo.commit(initial, [{ runId: "cas", sequence: 1, revision: 1, type: "RUN_CREATED", stepIds: [] }], null);
    const terminal = persistedWorkflowRunSchema.parse({ ...initial, revision: 2, running: false, completed: true, outcome: "success", scheduledOrder: ["root"], executionOrder: ["root"], steps: { root: { id: "root", status: "success", result: ok() } } });
    const event = [{ runId: "cas", sequence: 2, revision: 2, type: "LAYER_COMPLETED" as const, stepIds: ["root"] }, { runId: "cas", sequence: 3, revision: 2, type: "RUN_COMPLETED" as const, stepIds: [] }];
    const writes = await Promise.allSettled([repo.commit(terminal, event, 1), repo.commit(terminal, event, 1)]);
    expect(writes.map(({ status }) => status).sort()).toEqual(["fulfilled", "rejected"]);
  });

  it("rejects status mismatches and incomplete terminal snapshots", () => {
    const base = { schemaVersion: 1 as const, runId: "bad", workflowId: "w", workflowRevision: "r", topology: [{ id: "root", dependsOn: [] }], context: {}, revision: 2, running: false, completed: true, outcome: "success" as const, scheduledOrder: ["root"], executionOrder: ["root"], steps: { root: { id: "root", status: "partial", result: ok() } } };
    expect(persistedWorkflowRunSchema.safeParse(base).success).toBe(false);
    expect(persistedWorkflowRunSchema.safeParse({ ...base, scheduledOrder: [], executionOrder: [], steps: {} }).success).toBe(false);
    expect(persistedWorkflowRunSchema.safeParse({ ...base, steps: { wrong: base.steps.root } }).success).toBe(false);
    expect(persistedWorkflowRunSchema.safeParse({ ...base, outcome: "blocked", executionOrder: [], steps: { root: { id: "root", status: "skipped", blockedBy: ["x", "x"] } } }).success).toBe(false);
  });

  it("rejects non-empty RUN_CREATED payloads", async () => {
    const repo = new InMemoryWorkflowRunRepository();
    const initial = persistedWorkflowRunSchema.parse({ schemaVersion: 1, runId: "created", workflowId: "w", workflowRevision: "r", topology: [{ id: "root", dependsOn: [] }], context: {}, revision: 1, running: true, completed: false, scheduledOrder: [], executionOrder: [], steps: {} });
    await expect(repo.commit(initial, [{ runId: "created", sequence: 1, revision: 1, type: "RUN_CREATED", stepIds: ["root"] }], null)).rejects.toThrow("empty RUN_CREATED");
  });
  it("round trips detached values and rejects stale revisions atomically", async () => {
    const repo = new InMemoryWorkflowRunRepository();
    await startPersistedWorkflow(workflow([]), {}, "run-1", repo);
    const loaded = await repo.load("run-1");
    loaded.snapshot.scheduledOrder.push("tamper");
    expect((await repo.load("run-1")).snapshot.scheduledOrder).not.toContain("tamper");
    await expect(repo.commit(loaded.snapshot, [], 1)).rejects.toThrow();
  });

  it("resumes after a checkpoint interruption without rerunning completed layers", async () => {
    const backing = new InMemoryWorkflowRunRepository();
    let commits = 0;
    const flaky: WorkflowRunRepository = {
      load: (id) => backing.load(id),
      commit: async (...args) => { commits++; if (commits === 3) throw new Error("storage down"); await backing.commit(...args); },
    };
    const calls: string[] = [];
    await expect(startPersistedWorkflow(workflow(calls), {}, "run-2", flaky)).rejects.toThrow("storage down");
    expect(calls.map((item) => item.split(":")[0])).toEqual(["a", "b", "join"]);
    const resumed = await resumeWorkflow(workflow(calls), "run-2", backing);
    expect(resumed.status).toBe("success");
    expect(calls.map((item) => item.split(":")[0])).toEqual(["a", "b", "join", "join"]);
    const persisted = await backing.load("run-2");
    expect(persisted.events.map((event) => event.type)).toEqual(["RUN_CREATED", "LAYER_COMPLETED", "LAYER_COMPLETED", "RUN_COMPLETED"]);
    expect(persisted.events[1]?.stepIds).toEqual(["a", "b"]);
    expect(calls.every((item) => item.includes("run-2:rev-1:"))).toBe(true);
  });

  it("terminal resume invokes no handlers and validates identity", async () => {
    const repo = new InMemoryWorkflowRunRepository(); const calls: string[] = [];
    await startPersistedWorkflow(workflow(calls), {}, "run-3", repo);
    calls.length = 0;
    await resumeWorkflow(workflow(calls), "run-3", repo);
    expect(calls).toEqual([]);
    await expect(resumeWorkflow(workflow([], "wrong"), "run-3", repo)).rejects.toBeInstanceOf(InvalidWorkflowError);
    await expect(resumeWorkflow({ ...workflow([]), id: "wrong" }, "run-3", repo)).rejects.toBeInstanceOf(InvalidWorkflowError);
    const base = workflow([]);
    const changed = { ...base, steps: base.steps.map((step) => step.id === "join" ? { ...step, dependsOn: ["a"] } : step) };
    await expect(resumeWorkflow(changed, "run-3", repo)).rejects.toThrow("topology mismatch");
  });

  it("rejects corrupt persisted successful output before invoking handlers", async () => {
    const repo = new InMemoryWorkflowRunRepository();
    await startPersistedWorkflow(workflow([]), {}, "run-corrupt", repo);
    const loaded = await repo.load("run-corrupt");
    const corrupt: WorkflowRunRepository = { load: async () => ({ ...loaded, snapshot: { ...loaded.snapshot, steps: { ...loaded.snapshot.steps, a: { ...loaded.snapshot.steps.a!, result: { ...loaded.snapshot.steps.a!.result!, output: "bad" } } } } }), commit: (...args) => repo.commit(...args) };
    await expect(resumeWorkflow(workflow([]), "run-corrupt", corrupt)).rejects.toThrow();
  });

  it("rejects invalid persisted order and audit history", async () => {
    const repo = new InMemoryWorkflowRunRepository();
    await startPersistedWorkflow(workflow([]), {}, "run-history", repo);
    const loaded = await repo.load("run-history");
    const badOrder: WorkflowRunRepository = { load: async () => ({ ...loaded, snapshot: { ...loaded.snapshot, scheduledOrder: ["b", "a", "join"], executionOrder: ["b", "a", "join"] } }), commit: (...args) => repo.commit(...args) };
    await expect(resumeWorkflow(workflow([]), "run-history", badOrder)).rejects.toThrow("Scheduled order");
    const badAudit: WorkflowRunRepository = { load: async () => ({ ...loaded, events: loaded.events.map((event, index) => index === 1 ? { ...event, sequence: 99 } : event) }), commit: (...args) => repo.commit(...args) };
    await expect(resumeWorkflow(workflow([]), "run-history", badAudit)).rejects.toThrow("sequence");
    const unknownAuditField: WorkflowRunRepository = { load: async () => ({ ...loaded, events: loaded.events.map((event, index) => index === 0 ? { ...event, injected: true } : event) }), commit: (...args) => repo.commit(...args) };
    await expect(resumeWorkflow(workflow([]), "run-history", unknownAuditField)).rejects.toThrow("unrecognized");
  });

  it("does not schedule later layers when a checkpoint fails", async () => {
    const repo = new InMemoryWorkflowRunRepository(); const calls: string[] = [];
    let writes = 0;
    const failing: WorkflowRunRepository = { load: (id) => repo.load(id), commit: async (...args) => { if (++writes === 2) throw new Error("no write"); await repo.commit(...args); } };
    await expect(startPersistedWorkflow(workflow(calls), {}, "run-4", failing)).rejects.toThrow("no write");
    expect(calls.map((item) => item.split(":")[0])).toEqual(["a", "b"]);
  });

  it("resumes a terminal normalized failure whose success output is non-null", async () => {
    const repo = new InMemoryWorkflowRunRepository();
    const definition: PersistedWorkflowDefinition<Record<string, never>> = { id: "failure-output", revision: "r1", steps: [{ id: "fail", dependsOn: [], outputSchema: z.string(), projectDependencies: directDependencyResults, run: async () => { throw new Error("boom"); } }] };
    expect((await startPersistedWorkflow(definition, {}, "failed-run", repo)).status).toBe("failed");
    expect((await resumeWorkflow(definition, "failed-run", repo)).status).toBe("failed");
  });
});
