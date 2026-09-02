# @retroport/cli

Command-line entry point for RetroPort workflows.

The CLI exposes the compatibility doctor, static-analysis export, Amiberry
capture, Semantic IR verification, and the Phase 0 acceptance gate.

`retroport capture` always writes observations as JSON to stdout. Pass
`--database captures.sqlite` to persist the same validated capture as an
immutable, tick-ordered SQLite batch for later verification.
