-- Schema version 1: durable workflow checkpoints, audit events, and CAS artifacts.
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
