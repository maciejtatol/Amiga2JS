# @retroport/cli

Command-line entry point for RetroPort workflows.

The CLI exposes the compatibility doctor, ADF/HUNK inspection, static-analysis
export, deterministic reconstruction/review, Amiberry capture, Semantic IR
verification, and the Phase 0 acceptance gate.

Use `retroport preflight --input <file> --manifest <file.json>` to verify an
artifact's SHA-256 digest and HUNK structure before handing it to Ghidra.

Use `retroport inspect-adf --input <file.adf>` to inspect ADF geometry, boot
and root-block signals, packer/protection markers, and SHA-1/SHA-256 digests.

Use `retroport inspect-adf-set --input-dir <directory> [--expected-disks N]`
to validate disk numbering, completeness, and consistent geometry before
attempting extraction.

Use `retroport write-adf-manifest --input-dir <directory> --output <file.json>
--set-id <id> --title <title> --source <reference> --license-status
<owned-dump|authorized|redistributable|unknown>` to persist the inspection and
provenance record. `--tool` and `--notes` are optional.

Use `retroport plan-adf-extraction --input <file.adf>` to select the next safe
extraction boundary. Custom boot or packed images return a non-zero status and
identify the emulator-assisted actions still required.

For headless static analysis, pass the repository's
`tools/ghidra/RetroPortSnapshot.java` script to `retroport analyze`.

Use `retroport reconstruct --observations <file.json> [--static <file.json>]
[--metadata <file.json>] [--candidate-output <file.json>]
[--ir-output <file.json>]` to infer horizontal movement from contiguous runtime
deltas and independently review the resulting candidate. With explicit
execution metadata, the command emits a validated movement IR; the output
options save the candidate and IR as standalone JSON files.

Use `retroport generate --ir <file.json>` to emit deterministic TypeScript from
a validated movement IR.

Use `retroport grade --candidate <file.json> --ground-truth <file.json>` to
compare a candidate with separately held source ground truth. The command
blocks on field, input-mapping, or writer-address mismatches.

Use `retroport experiment --server <url> --artifact <sha256:...> --field
<address> --value <number> --input <LEFT|RIGHT|NONE> --addresses <list>` to
run one controlled state-patch experiment and report the movement delta after
exactly one frame.

Use `retroport phase0` to run the repository-owned deterministic vertical slice
without external services. It prints a concise gate summary suitable for CI.

Use `retroport phase0-captured --artifact <sha256:...> --scenarios
scenarios.json --initial-state initial-state.json --observations observations.json
--metadata movement-metadata.json --ground-truth ground-truth.json [--static
snapshot.json]` to run the same pipeline over observations captured from an
external Amiberry oracle. The command prints the manifest and exits non-zero
when reconstruction, verification, or grading is blocked.

`retroport capture` always writes observations as JSON to stdout. Pass
`--database captures.sqlite` to persist the same validated capture as an
immutable, tick-ordered SQLite batch for later verification.

The repository also ships a Compose service for local runs. Use
`docker compose run --rm retroport` to execute the acceptance gate with a
named volume mounted at `/data` for SQLite files.
