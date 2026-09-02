-- Schema version 2: immutable runtime observations captured from Amiberry.
CREATE TABLE IF NOT EXISTS runtime_observations (
  scenario_id TEXT NOT NULL,
  tick INTEGER NOT NULL,
  observation_json TEXT NOT NULL,
  PRIMARY KEY (scenario_id, tick)
) STRICT;
