import { unlinkSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ContentAddressedArtifactStore,
  DatabaseSync,
  SqliteRuntimeObservationRepository,
  SqliteWorkflowRunRepository,
} from "../src/index.js";
import { InMemoryWorkflowRunRepository, startPersistedWorkflow } from "@retroport/core";
import type { PersistedWorkflowDefinition } from "@retroport/core";
import type { RuntimeObservation } from "@retroport/runtime-amiberry";
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

describe("SqliteRuntimeObservationRepository", () => {
  const observations: RuntimeObservation[] = [
    { scenarioId: "movement", tick: 1, input: "NONE", state: { playerX: 2 } },
    { scenarioId: "movement", tick: 0, input: "RIGHT", state: { playerX: 2 } },
  ];

  it("persists observations in tick order and returns detached values", async () => {
    const database = new DatabaseSync(":memory:");
    const repository = new SqliteRuntimeObservationRepository(database);
    await repository.save(observations);

    const loaded = await repository.load("movement");
    expect(loaded.map(({ tick }) => tick)).toEqual([0, 1]);
    (loaded[0]!.state as Record<string, number>).playerX = 99;
    await expect(repository.load("movement")).resolves.toEqual([
      observations[1], observations[0],
    ]);
    database.close();
  });

  it("survives a new repository instance and rejects duplicate or mixed batches", async () => {
    const path = `/tmp/retroport-observations-${Date.now()}-${Math.random()}.sqlite`;
    const firstDatabase = new DatabaseSync(path);
    await new SqliteRuntimeObservationRepository(firstDatabase).save(observations);
    firstDatabase.close();

    const secondDatabase = new DatabaseSync(path);
    const repository = new SqliteRuntimeObservationRepository(secondDatabase);
    await expect(repository.load("movement")).resolves.toHaveLength(2);
    await expect(repository.save(observations)).rejects.toThrow("already saved");
    await expect(repository.save([
      observations[0]!,
      { ...observations[0]!, scenarioId: "other" },
    ])).rejects.toThrow("one scenario");
    secondDatabase.close();
    unlinkSync(path);
  });

  it("rejects duplicate ticks before writing", async () => {
    const database = new DatabaseSync(":memory:");
    const repository = new SqliteRuntimeObservationRepository(database);
    await expect(repository.save([
      observations[0]!, observations[0]!,
    ])).rejects.toThrow("ticks must be unique");
    await expect(repository.load("movement")).resolves.toEqual([]);
    database.close();
  });

  it("detects rows whose JSON no longer matches their SQLite index", async () => {
    const database = new DatabaseSync(":memory:");
    const repository = new SqliteRuntimeObservationRepository(database);
    await repository.save([observations[0]!]);
    database.prepare(
      "UPDATE runtime_observations SET observation_json = ? WHERE scenario_id = ? AND tick = ?",
    ).run(JSON.stringify({ ...observations[0]!, tick: 7 }), "movement", 1);

    await expect(repository.load("movement")).rejects.toThrow("does not match");
    database.close();
  });
});
