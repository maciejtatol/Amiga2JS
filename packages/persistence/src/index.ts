import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  persistedWorkflowRunSchema,
  workflowAuditEventSchema,
  type PersistedWorkflowRun,
  type WorkflowAuditEvent,
} from "@retroport/schemas";
import {
  WorkflowRunAlreadyExistsError,
  WorkflowRunNotFoundError,
  WorkflowRunRevisionError,
  type WorkflowRunRepository,
  validateWorkflowRunHistory,
} from "@retroport/core";
import {
  runtimeObservationSchema,
  type RuntimeObservation,
  type RuntimeObservationRepository,
} from "@retroport/runtime-amiberry";

export interface ArtifactStore {
  put(content: Uint8Array, mediaType?: string): Promise<string>;
  get(artifactId: string): Promise<{ content: Uint8Array; mediaType: string } | null>;
  has(artifactId: string): Promise<boolean>;
}

const artifactIdFor = (content: Uint8Array): string =>
  `sha256:${createHash("sha256").update(content).digest("hex")}`;

const migrations = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS workflow_runs (
        run_id TEXT PRIMARY KEY,
        revision INTEGER NOT NULL,
        snapshot_json TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS workflow_events (
        run_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        event_json TEXT NOT NULL,
        PRIMARY KEY (run_id, sequence),
        FOREIGN KEY (run_id) REFERENCES workflow_runs(run_id) ON DELETE CASCADE
      ) STRICT;
      CREATE TABLE IF NOT EXISTS artifacts (
        artifact_id TEXT PRIMARY KEY,
        content BLOB NOT NULL,
        media_type TEXT NOT NULL
      ) STRICT;
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE IF NOT EXISTS runtime_observations (
        scenario_id TEXT NOT NULL,
        tick INTEGER NOT NULL,
        observation_json TEXT NOT NULL,
        PRIMARY KEY (scenario_id, tick)
      ) STRICT;
    `,
  },
] as const;

const workflowEventsQuery =
  "SELECT event_json FROM workflow_events WHERE run_id = ? ORDER BY sequence";

function applyMigrations(database: DatabaseSync): void {
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY) STRICT");
  const applied = new Set(database.prepare("SELECT version FROM schema_migrations").all()
    .map((row) => Number(row.version)));
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    database.exec("BEGIN");
    try {
      database.exec(migration.sql);
      database.prepare("INSERT INTO schema_migrations (version) VALUES (?)").run(migration.version);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}

function loadEvents(database: DatabaseSync, runId: string): WorkflowAuditEvent[] {
  const rows = database.prepare(workflowEventsQuery).all(runId);
  return parseEvents(rows);
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertImmutableWorkflow(
  current: PersistedWorkflowRun,
  next: PersistedWorkflowRun,
): void {
  const identityChanged = current.workflowId !== next.workflowId
    || current.workflowRevision !== next.workflowRevision
    || !sameValue(current.topology, next.topology)
    || !sameValue(current.context, next.context);
  if (identityChanged) {
    throw new WorkflowRunRevisionError("Persisted workflow identity is immutable");
  }

  for (const [id, record] of Object.entries(current.steps)) {
    if (!sameValue(next.steps[id], record)) {
      throw new WorkflowRunRevisionError(`Committed step cannot change: ${id}`);
    }
  }
}

function assertEventBatch(
  events: readonly WorkflowAuditEvent[],
  priorEvents: readonly WorkflowAuditEvent[],
  snapshot: PersistedWorkflowRun,
): void {
  for (const [index, event] of events.entries()) {
    const expectedSequence = priorEvents.length + index + 1;
    if (
      event.runId !== snapshot.runId
      || event.sequence !== expectedSequence
      || event.revision !== snapshot.revision
    ) {
      throw new WorkflowRunRevisionError("Invalid audit sequence or revision");
    }
  }
}

function withTransaction<T>(database: DatabaseSync, operation: () => T): T {
  // BEGIN IMMEDIATE reserves the write lock before validation, so the revision
  // check and every row change observe one consistent writer.
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export class ContentAddressedArtifactStore implements ArtifactStore {
  constructor(private readonly database: DatabaseSync) {
    applyMigrations(database);
  }

  async put(content: Uint8Array, mediaType = "application/octet-stream"): Promise<string> {
    // The digest is based on bytes only. Metadata is retained from the first
    // write because changing it would make an immutable artifact ambiguous.
    const artifactId = artifactIdFor(content);
    this.database.prepare(
      "INSERT OR IGNORE INTO artifacts (artifact_id, content, media_type) VALUES (?, ?, ?)",
    ).run(artifactId, content, mediaType);
    return artifactId;
  }

  async get(artifactId: string): Promise<{ content: Uint8Array; mediaType: string } | null> {
    const row = this.database.prepare(
      "SELECT content, media_type FROM artifacts WHERE artifact_id = ?",
    ).get(artifactId) as { content: Uint8Array; media_type: string } | undefined;
    if (!row) return null;
    const content = new Uint8Array(row.content);
    // Re-hash on read so a damaged or manually altered blob is never returned
    // as though it were the artifact named by the caller.
    return artifactIdFor(content) === artifactId
      ? { content, mediaType: row.media_type }
      : null;
  }

  async has(artifactId: string): Promise<boolean> {
    return (await this.get(artifactId)) !== null;
  }
}

const parseSnapshot = (json: string): PersistedWorkflowRun =>
  persistedWorkflowRunSchema.parse(JSON.parse(json));
const parseEvents = (rows: readonly Record<string, unknown>[]): WorkflowAuditEvent[] =>
  workflowAuditEventSchema.array().parse(rows.map(({ event_json }) => JSON.parse(String(event_json))));

export class SqliteWorkflowRunRepository implements WorkflowRunRepository {
  constructor(private readonly database: DatabaseSync) {
    applyMigrations(database);
  }

  async load(runId: string): Promise<{ snapshot: PersistedWorkflowRun; events: readonly WorkflowAuditEvent[] }> {
    const row = this.database.prepare(
      "SELECT snapshot_json FROM workflow_runs WHERE run_id = ?",
    ).get(runId) as { snapshot_json: string } | undefined;
    if (!row) throw new WorkflowRunNotFoundError(`Workflow run not found: ${runId}`);
    const snapshot = parseSnapshot(row.snapshot_json);
    const events = loadEvents(this.database, runId);
    validateWorkflowRunHistory(snapshot, events);
    return { snapshot, events };
  }

  async commit(
    snapshotInput: PersistedWorkflowRun,
    eventsInput: readonly WorkflowAuditEvent[],
    expectedRevision: number | null,
  ): Promise<void> {
    const snapshot = persistedWorkflowRunSchema.parse(structuredClone(snapshotInput));
    const events = workflowAuditEventSchema.array().parse(structuredClone(eventsInput));
    if (events.length === 0) throw new WorkflowRunRevisionError("Each commit requires at least one audit event");
    withTransaction(this.database, () => {
      const current = this.database.prepare(
        "SELECT revision, snapshot_json FROM workflow_runs WHERE run_id = ?",
      ).get(snapshot.runId) as { revision: number; snapshot_json: string } | undefined;
      if (expectedRevision === null) {
        if (current) throw new WorkflowRunAlreadyExistsError(`Workflow run already exists: ${snapshot.runId}`);
        if (snapshot.revision !== 1 || events.length !== 1 || events[0]?.type !== "RUN_CREATED") {
          throw new WorkflowRunRevisionError("Initial commit requires revision 1 and RUN_CREATED");
        }
      } else {
        if (!current) throw new WorkflowRunNotFoundError(`Workflow run not found: ${snapshot.runId}`);
        if (current.revision !== expectedRevision || snapshot.revision !== expectedRevision + 1) {
          throw new WorkflowRunRevisionError(`Expected revision ${expectedRevision}`);
        }
        const prior = parseSnapshot(current.snapshot_json);
        const priorEvents = loadEvents(this.database, snapshot.runId);
        validateWorkflowRunHistory(prior, priorEvents);
        assertImmutableWorkflow(prior, snapshot);
        if (events[0]?.type !== "LAYER_COMPLETED") throw new WorkflowRunRevisionError("Checkpoint requires LAYER_COMPLETED");
      }
      const priorEvents = current ? loadEvents(this.database, snapshot.runId) : [];
      assertEventBatch(events, priorEvents, snapshot);
      if (snapshot.completed !== events.some(({ type }) => type === "RUN_COMPLETED")) {
        throw new WorkflowRunRevisionError("Terminal event and snapshot must agree");
      }
      validateWorkflowRunHistory(snapshot, [...priorEvents, ...events]);
      this.database.prepare(
        `INSERT INTO workflow_runs (run_id, revision, snapshot_json) VALUES (?, ?, ?)
         ON CONFLICT(run_id) DO UPDATE SET revision = excluded.revision, snapshot_json = excluded.snapshot_json`,
      ).run(snapshot.runId, snapshot.revision, JSON.stringify(snapshot));
      const insertEvent = this.database.prepare(
        "INSERT INTO workflow_events (run_id, sequence, event_json) VALUES (?, ?, ?)",
      );
      for (const event of events) insertEvent.run(event.runId, event.sequence, JSON.stringify(event));
    });
  }
}

const runtimeObservationsQuery =
  "SELECT scenario_id, tick, observation_json FROM runtime_observations WHERE scenario_id = ? ORDER BY tick";

/** Stores one immutable, ordered capture for each runtime scenario. */
export class SqliteRuntimeObservationRepository implements RuntimeObservationRepository {
  constructor(private readonly database: DatabaseSync) {
    applyMigrations(database);
  }

  async save(input: readonly RuntimeObservation[]): Promise<void> {
    const observations = runtimeObservationSchema.array().parse(structuredClone(input));
    const scenarioIds = new Set(observations.map(({ scenarioId }) => scenarioId));
    if (scenarioIds.size !== 1) {
      throw new Error("An observation batch must contain one scenario");
    }
    const scenarioId = observations[0]!.scenarioId;
    const ticks = new Set(observations.map(({ tick }) => tick));
    if (ticks.size !== observations.length) {
      throw new Error(`Observation ticks must be unique for scenario: ${scenarioId}`);
    }

    withTransaction(this.database, () => {
      const existing = this.database.prepare(
        "SELECT 1 FROM runtime_observations WHERE scenario_id = ? LIMIT 1",
      ).get(scenarioId);
      if (existing) {
        throw new Error(`Observations already saved for scenario: ${scenarioId}`);
      }

      const insert = this.database.prepare(
        "INSERT INTO runtime_observations (scenario_id, tick, observation_json) VALUES (?, ?, ?)",
      );
      // Keep a capture all-or-nothing if any row fails to persist.
      for (const observation of observations) {
        insert.run(observation.scenarioId, observation.tick, JSON.stringify(observation));
      }
    });
  }

  async load(scenarioId: string): Promise<readonly RuntimeObservation[]> {
    const rows = this.database.prepare(runtimeObservationsQuery).all(scenarioId);
    const observations = rows.map(({ scenario_id, tick, observation_json }) => {
      const observation = runtimeObservationSchema.parse(JSON.parse(String(observation_json)));
      if (observation.scenarioId !== String(scenario_id) || observation.tick !== Number(tick)) {
        throw new Error("Persisted observation does not match its SQLite index");
      }
      return observation;
    });
    // Parse and clone persisted JSON so callers cannot mutate the database view.
    return structuredClone(observations);
  }
}

export { DatabaseSync };
