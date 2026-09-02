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

Capture runtime observations from an Amiberry automation server:

```sh
retroport capture \
  --server http://127.0.0.1:8000 \
  --artifact sha256:<64-hex-digest> \
  --scenario path/to/scenario.json \
  --addresses playerX,velocityX,tickCounter
```

Verify captured observations against a Semantic IR:

```sh
retroport verify \
  --scenario path/to/scenario.json \
  --initial-state path/to/initial-state.json \
  --ir path/to/movement-ir.json \
  --observations path/to/observations.json
```

Run the complete Phase 0 acceptance gate:

```sh
retroport acceptance
```

This runs three independent 1,000-tick replays for LEFT, RIGHT, and NONE.

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
and the `retroport doctor` diagnostic path. It also includes static-analysis
contracts, an Amiberry runtime boundary with deterministic observation capture
and first-divergence comparison, plus a synthetic HUNK fixture and strict
parser for testing the first source-analysis boundary.

The provider-neutral static-analysis and runtime transports are now defined;
the next vertical slice will connect them to a real Ghidra exporter and
Amiberry automation server. Phaser, model-provider integration, and Superfrog
reconstruction are not included yet.

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
  source-amiga-hunk/            Synthetic HUNK fixture builder and parser
  static-analysis/              Ghidra headless snapshot boundary
  runtime-amiberry/             Amiberry runtime-oracle boundary
  target-typescript/            Deterministic TypeScript target generator
  verification/                 Behavioral replay and divergence checks
compatibility/
  amiga/                       Community-extensible Amiga rules
fixtures/
  amiga-m68k-horizontal/       Deterministic Phase 0 fixture
docs/                          Architecture and project documentation
```

## Roadmap

1. Connect the static-analysis transport to a real deterministic Ghidra export.
2. Connect the runtime transport to an Amiberry automation server.
3. Reconstruct and independently verify horizontal movement.
4. Run the 1,000-tick, three-scenario acceptance suite.
5. Generate TypeScript and compare state tick by tick.

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
