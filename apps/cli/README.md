# @retroport/cli

Command-line entry point for RetroPort workflows.

The CLI exposes the compatibility doctor, HUNK inspection, static-analysis
export, Amiberry capture, Semantic IR verification, and the Phase 0 acceptance
gate.

For headless static analysis, pass the repository's
`tools/ghidra/RetroPortSnapshot.java` script to `retroport analyze`.

`retroport capture` always writes observations as JSON to stdout. Pass
`--database captures.sqlite` to persist the same validated capture as an
immutable, tick-ordered SQLite batch for later verification.

The repository also ships a Compose service for local runs. Use
`docker compose run --rm retroport` to execute the acceptance gate with a
named volume mounted at `/data` for SQLite files.
