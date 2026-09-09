<div align="center">

# Amiga2JS

### Evidence-driven reconstruction of legacy games

Turn Amiga/m68k binaries into maintainable TypeScript through static analysis,
runtime evidence, semantic reconstruction, and deterministic verification.

![Amiga2JS transforms legacy game binaries into modern source code](docs/assets/retroport-hero.png)

**Experimental · Phase 0 · Not ready for production use**

</div>

## Quick start

Requirements: **Node.js 22.13+** and **npm 10+**.

```sh
git clone https://github.com/maciejtatol/Amiga2JS.git
cd Amiga2JS
npm install
```

Run the complete local quality gate:

```sh
npm run lint
npm run typecheck
npm test
```

Run the same acceptance gate in a container. The SQLite database is stored in
the `retroport-data` Compose volume:

```sh
docker compose build
docker compose run --rm retroport
```

To persist a runtime capture, add `--database /data/captures.sqlite` to the
`retroport capture` command run through Compose. Ghidra and Amiberry remain
external services; this image provides their CLI integration points rather
than bundling those installations.

Build the deterministic Phase 0 fixture:

```sh
npm run build:fixture -w @retroport/source-amiga-hunk
```

Run the compatibility doctor against the included Phase 0 manifest:

```sh
npm run doctor --workspace @retroport/cli -- \
  --manifest fixtures/amiga-m68k-horizontal/project.example.json \
  --rules compatibility/amiga
```

Expected output:

```text
SUPPORTED
```

Inspect a HUNK input before static analysis. The command accepts either a
binary HUNK file or the checked-in hexadecimal fixture representation:

```sh
retroport inspect \
  --input fixtures/amiga-m68k-horizontal/build-stripped.hunk.hex
```

Validate an artifact's digest and HUNK structure before analysis:

```sh
retroport preflight \
  --input fixtures/amiga-m68k-horizontal/build-stripped.hunk.hex \
  --manifest fixtures/amiga-m68k-horizontal/manifest.json
```

Run a headless Ghidra export when Ghidra is installed:

```sh
retroport analyze \
  --analyze-headless /path/to/analyzeHeadless \
  --project-directory /tmp/ghidra-projects \
  --project-name amiga-fixture \
  --input /path/to/amiga-m68k-horizontal.hunk \
  --exporter /path/to/retroport-exporter.java
```

The input must be a decoded HUNK binary. The exporter must print one
`RETROPORT_SNAPSHOT=<json>` line. The command validates and emits the
normalized static-analysis snapshot.

The repository includes the deterministic exporter at
`tools/ghidra/RetroPortSnapshot.java`; see `tools/ghidra/README.md` for the
pinned headless invocation.

Capture runtime observations from an Amiberry automation server:

```sh
retroport capture \
  --server http://127.0.0.1:8000 \
  --artifact sha256:<64-hex-digest> \
  --scenario path/to/scenario.json \
  --addresses playerX,velocityX,tickCounter \
  --database captures.sqlite
```

The `--database` option is optional: captures are always printed as JSON, and
when supplied they are also saved as an immutable, tick-ordered SQLite batch.

Verify captured observations against a Semantic IR:

```sh
retroport verify \
  --scenario path/to/scenario.json \
  --initial-state path/to/initial-state.json \
  --ir path/to/movement-ir.json \
  --observations path/to/observations.json
```

Run deterministic horizontal-movement reconstruction and independent review:

```sh
retroport reconstruct \
  --observations path/to/observations.json \
  --static path/to/static-snapshot.json \
  --metadata path/to/movement-metadata.json \
  --candidate-output movement-candidate.json \
  --ir-output movement-ir.json
```

The static snapshot is optional; without it, writer-function correlation is
unavailable but runtime deltas can still be analyzed. Supplying explicit
execution metadata also emits a validated `HorizontalMovementIR` in the
result. `--ir-output` writes the IR as a standalone JSON file. Generate
readable TypeScript from it with:

```sh
retroport generate --ir path/to/movement-ir.json > generated/movement.ts
```

Keep source ground truth outside the analyst input and grade the exported
candidate independently:

```sh
retroport grade \
  --candidate movement-candidate.json \
  --ground-truth path/to/ground-truth.json
```

Run a controlled one-frame patch experiment against Amiberry:

```sh
retroport experiment \
  --server http://127.0.0.1:8000 \
  --artifact sha256:<64-hex-digest> \
  --field playerX \
  --value 100 \
  --input RIGHT \
  --addresses playerX
```

Run the complete Phase 0 acceptance gate:

```sh
retroport acceptance
```

This runs three independent 1,000-tick replays for LEFT, RIGHT, and NONE.

Run the complete local vertical slice, including reconstruction, review,
generation, differential verification, and ground-truth grading:

```sh
retroport phase0
```

## What is Amiga2JS?

Amiga2JS is an evidence-driven reverse-engineering project, not a
binary-to-JavaScript transpiler. Its RetroPort framework collects static and
runtime evidence, forms falsifiable semantic hypotheses, verifies them
independently, and only then generates modern source.

```text
legacy binary
    → static + runtime evidence
    → semantic reconstruction
    → independent verification
    → deterministic TypeScript
```

The initial source platform is **Commodore Amiga / Motorola 68000**. The first
target is a rendering-independent TypeScript simulation; browser and Phaser
adapters come later.

## Why evidence-driven?

- Every automatic conclusion points back to persisted evidence.
- AI hypotheses are never treated as ground truth.
- The emulator remains the runtime oracle.
- Verification compares behavior tick by tick and reports the first divergence.
- Partial, manual, and unsupported are valid outcomes—there is no fake success.
- Reconstructed physics, collision, and timing are not silently replaced with
  framework defaults.

## Current scope

Amiga2JS is in **Phase 0**. The current implementation includes runtime-
validated schemas, a deterministic workflow engine, evidence gates, resumable
SQLite persistence, content-addressed artifacts, a YAML compatibility registry,
and the `retroport doctor` diagnostic path. It also includes a synthetic HUNK
fixture and strict parser, a deterministic Ghidra headless exporter boundary,
an Amiberry runtime boundary with observation capture and one-frame state-patch
experiments, and independent
horizontal-movement reconstruction, review, IR conversion, and TypeScript
generation. Phaser, model-provider integration, and Superfrog reconstruction
are not included yet.

## Repository layout

```text
apps/
  cli/                         RetroPort command-line application
packages/
  core/                        Provider-neutral orchestration
  schemas/                     Runtime-validated contracts
  evidence/                    Evidence persistence and queries
  compatibility/               Rules and capability diagnostics
  persistence/                  SQLite persistence and artifact storage
  phase0-pipeline/              Local deterministic vertical-slice runner
  source-amiga-hunk/            Synthetic HUNK fixture builder and parser
  static-analysis/              Ghidra headless snapshot boundary
  runtime-amiberry/             Amiberry runtime-oracle boundary
  reconstruction/               Deterministic semantic analyst and reviewer
  target-typescript/            Deterministic TypeScript target generator
  verification/                 Behavioral replay and divergence checks
compatibility/
  amiga/                       Community-extensible Amiga rules
fixtures/
  amiga-m68k-horizontal/       Deterministic Phase 0 fixture
docs/                          Architecture and project documentation
```

## Roadmap

1. Run the complete vertical slice against a real Ghidra installation and
   Amiberry automation server (the local provider-neutral boundaries are ready).
2. Generate TypeScript from the reviewed movement claim and compare state tick
   by tick against captured observations.
3. Add a real stripped-fixture ground-truth export and then an external
   open-source Amiga fixture.

Superfrog is a later real-world reference target, not the Phase 0 input.

## Contributing

The project is early, so small, testable changes are preferred. Before opening
a pull request, run:

```sh
npm run typecheck
npm test
```

Compatibility knowledge should be contributed as validated rules rather than
hard-coded special cases.

## License

License terms have not been selected yet. Until a license file is added, do not
assume the repository grants redistribution rights.
