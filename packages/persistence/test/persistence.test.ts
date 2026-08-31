import { unlinkSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ContentAddressedArtifactStore,
  DatabaseSync,
  SqliteWorkflowRunRepository,
} from "../src/index.js";
import { InMemoryWorkflowRunRepository, startPersistedWorkflow } from "@retroport/core";
import type { PersistedWorkflowDefinition } from "@retroport/core";
import { z } from "zod";

const definition: PersistedWorkflowDefinition<{ value: string }> = {
  id: "sqlite-test",
  revision: "1",
  steps: [{
    id: "step",
    dependsOn: [],
    outputSchema: z.object({ value: z.string() }),
    projectDependencies: () => ({}),
    run: async ({ context }) => ({
      status: "success", output: { value: context.value }, evidence: [],
      assumptions: [], warnings: [], confidence: 1, nextActions: [],
    }),
  }],
};

describe("ContentAddressedArtifactStore", () => {
  it("deduplicates bytes and returns detached content", async () => {
    const database = new DatabaseSync(":memory:");
    const store = new ContentAddressedArtifactStore(database);
    const bytes = new Uint8Array([1, 2, 3]);
    const first = await store.put(bytes, "application/test");
    const second = await store.put(new Uint8Array(bytes), "other/type");
    expect(first).toBe(second);
    expect(await store.has(first)).toBe(true);
    const loaded = await store.get(first);
    expect(loaded?.mediaType).toBe("application/test");
    expect([...loaded!.content]).toEqual([1, 2, 3]);
    database.close();
  });
});

describe("SqliteWorkflowRunRepository", () => {
  it("persists and resumes a workflow", async () => {
    const database = new DatabaseSync(":memory:");
    const repository = new SqliteWorkflowRunRepository(database);
    const result = await startPersistedWorkflow(definition, { value: "ok" }, "run-1", repository);
    expect(result.status).toBe("success");
    const loaded = await repository.load("run-1");
    expect(loaded.events.map(({ type }) => type)).toEqual(["RUN_CREATED", "LAYER_COMPLETED", "RUN_COMPLETED"]);
    expect(loaded.snapshot.outcome).toBe("success");
    database.close();
  });

  it("survives a new repository instance on a file-backed database", async () => {
    const path = `/tmp/retroport-persistence-${Date.now()}-${Math.random()}.sqlite`;
    const firstDatabase = new DatabaseSync(path);
    await startPersistedWorkflow(definition, { value: "saved" }, "run-2", new SqliteWorkflowRunRepository(firstDatabase));
    firstDatabase.close();
    const secondDatabase = new DatabaseSync(path);
    const loaded = await new SqliteWorkflowRunRepository(secondDatabase).load("run-2");
    expect(loaded.snapshot.context).toEqual({ value: "saved" });
    secondDatabase.close();
    unlinkSync(path);
  });

  it("retains optimistic concurrency semantics", async () => {
    const database = new DatabaseSync(":memory:");
    const repository = new SqliteWorkflowRunRepository(database);
    const memory = new InMemoryWorkflowRunRepository();
    const result = await startPersistedWorkflow(definition, { value: "ok" }, "run-3", memory);
    const loaded = await memory.load("run-3");
    await expect(repository.commit(loaded.snapshot, loaded.events, null)).rejects.toThrow();
    database.close();
    expect(result.status).toBe("success");
  });
});
