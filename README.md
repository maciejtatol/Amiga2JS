# RetroPort AI

RetroPort AI is an open-source, evidence-driven reverse-engineering framework for
reconstructing legacy game binaries as maintainable modern source code.

The initial source platform is Commodore Amiga with Motorola 68000 executables.
The first output target is a deterministic TypeScript simulation. Browser and
Phaser adapters will be added only after reconstructed behavior can be verified
against an emulator reference.

## Project status

RetroPort AI is in its initial scaffolding phase. The first vertical slice will
use a tiny, redistributable Amiga fixture owned by this repository. Superfrog is
a later reference target and is intentionally outside the v0.1 scope.

## Principles

- Evidence comes before source generation.
- AI-generated hypotheses are not treated as ground truth.
- Reconstructed behavior is verified independently and deterministically.
- Static analysis, runtime analysis, semantic reconstruction, and target output
  are separated behind explicit interfaces.
- Unsupported or partially supported inputs are reported honestly.

## Repository layout

```text
apps/
  cli/                         RetroPort command-line application
packages/
  core/                        Orchestration and provider-neutral interfaces
  schemas/                     Shared runtime-validated contracts
  evidence/                    Evidence persistence and query APIs
  compatibility/               Compatibility rules and diagnostics
fixtures/
  amiga-m68k-horizontal/       Phase 0 deterministic Amiga fixture
docs/                          Architecture and contributor documentation
```

## Development

Requirements:

- Node.js 22 or newer
- pnpm 10

Install dependencies and run the repository checks:

```sh
pnpm install
pnpm typecheck
pnpm test
```

The package implementations and test suites will be introduced in subsequent
milestones. Ghidra, Amiberry, Phaser, and model-provider integrations are not
part of the initial scaffold.

## License

License terms have not been selected yet. Until a license file is added, the
repository should not be assumed to grant redistribution rights.
