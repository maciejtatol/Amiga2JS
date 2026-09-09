# @retroport/phase0-pipeline

Runs the repository-owned deterministic Phase 0 vertical slice. It builds
runtime observations from an injected fixture step, performs reconstruction and
independent review, converts the approved candidate to IR, verifies each
scenario, generates TypeScript, and grades the candidate against separately
provided ground truth.

The fixture step is injected deliberately: CI does not need an emulator, while
the same orchestration can later be supplied with real Amiberry captures.
