# RetroPort AI - Codex Handoff

## Purpose

This document transfers the current RetroPort AI project context into a coding agent session.

RetroPort AI is an open-source, evidence-driven reverse-engineering framework for reconstructing legacy game binaries into maintainable modern source code.

Initial platform:
- Commodore Amiga
- Motorola 68000

Initial output target:
- TypeScript / Node.js
- browser runtime later
- Phaser later as rendering/input/audio adapter, not simulation authority

Long-term abstraction:

```text
legacy executable / disk image
        -> source platform adapter
        -> static + dynamic evidence
        -> semantic reconstruction IR
        -> independent verification
        -> target adapter
        -> maintainable modern source
```

Reference commercial target later: Superfrog.

Do NOT begin implementation against Superfrog. Phase 0 uses a tiny redistributable fixture authored inside the repo.

---

# Core principles

1. Evidence before generation.
2. AI forms hypotheses but is never the source of truth.
3. Emulator is the reference/oracle for runtime behavior.
4. Semantic reconstruction is preferred over m68k-to-JS instruction transliteration.
5. Unsupported/partial/manual are valid results.
6. Analyst and reviewer roles are separated.
7. Generated behavior must be independently verified.
8. Compatibility warnings are first-class, community-extensible data.
9. Source-analysis adapters and target adapters are separated by Semantic IR.
10. Project state must be persistent and resumable.
11. First-divergence detection is preferred over visual approximation.
12. Do not silently replace reconstructed physics/collision/timing with Phaser defaults.

---

# Phase 0 decisions

Workflow gate: `GO_WITH_WARNINGS`.

## Locked v0.1 stack

| Layer | Choice |
| --- | --- |
| Host language | TypeScript / Node.js |
| Monorepo | pnpm |
| Static RE | Ghidra 12.0.1 |
| Amiga Ghidra extension | BartmanAbyss/ghidra-amiga 20260128 |
| Static automation | Ghidra `analyzeHeadless` + deterministic exporter scripts |
| Interactive AI/Ghidra | optional MCP adapter |
| Runtime oracle | Amiberry |
| Runtime automation | Amiberry IPC / HTTP automation server |
| v0.1 input | Amiga HUNK executable |
| Persistence | SQLite + content-addressed artifacts |
| Schemas | Zod + JSON Schema |
| Tests | Vitest |
| v0.1 output | deterministic TypeScript simulation |
| Later renderer | Phaser adapter |

Important architectural decision:

**Ghidra MCP is not the canonical automation path.**

Core automation must use deterministic headless Ghidra exports. MCP is an optional interactive agent interface.

---

# Phase 0 fixture

Create a tiny Amiga/m68k executable owned by this repo.

Ground-truth state:

```text
GameState
  playerX: signed 16-bit integer
  velocityX: signed 16-bit integer
  inputState: byte
  tickCounter: unsigned 32-bit integer
```

Behavior:

```text
LEFT  -> velocityX = -2
RIGHT -> velocityX = +2
NONE  -> velocityX = 0

playerX += velocityX once per simulation tick
```

The reconstruction agents must only see a stripped HUNK executable.

A separate ground-truth file, inaccessible to reconstruction agents, records source symbols/addresses for final grading.

Example private verifier metadata:

```yaml
truth:
  player_x:
    symbol: player_x
    width: 16
    signed: true
  update_function:
    symbol: update_player
```

Do not optimize Phase 0 around graphics. A tiny visible marker is enough if useful for correlation.

---

# v0.1 acceptance criteria

The system must:

1. Build the fixture.
2. Produce a stripped HUNK binary for analysis.
3. Import/analyze it with headless Ghidra.
4. Export functions, xrefs, memory regions and useful decompiler/disassembly evidence.
5. Start Amiberry from a known state.
6. Execute deterministic LEFT / RIGHT / IDLE scenarios.
7. Capture runtime observations.
8. Infer player X and the movement writer without source symbols.
9. Pass the hypothesis through an isolated skeptical reviewer.
10. Verify the hypothesis with a controlled experiment.
11. Emit a small Semantic IR.
12. Generate deterministic TypeScript simulation code.
13. Replay the same logical input scenario.
14. Compare state tick-by-tick.
15. Reveal ground truth only during final grading.

Minimum PASS:

```text
1000 ticks
0 unexplained state divergences
3/3 deterministic target replays
correct player-X semantic identification
correct movement-writer identification
```

---

# High-level workflow

```text
                           ORCHESTRATOR
                                |
                         PHASE A - TRIAGE
                                |
          +---------------------+---------------------+
          |                     |                     |
     Input Inspector     Compatibility Doctor     Legal Boundary
          |                     |                     |
          +---------------------+---------------------+
                                |
                          TRIAGE GATE
                  STOP / MANUAL / PARTIAL / GO
                                |
                       PHASE B - DISCOVERY
                                |
          +---------------------+---------------------+
          |                     |                     |
      Static RE             Dynamic RE             Asset RE
       Ghidra                Amiberry              optional
          |                     |                     |
          +---------------------+---------------------+
                                |
                          Evidence Store
                                |
                    PHASE C - RECONSTRUCTION
                                |
                       Semantic Analyst
                                |
                       Skeptical Reviewer
                                |
                      Experiment Designer
                                |
                         Evidence Gate
                                |
                          Semantic IR
                                |
                      PHASE D - PORTING
                                |
                       Target Port Agent
                                |
                       Code Review Agent
                                |
                    PHASE E - VALIDATION
                                |
             +------------------+------------------+
             |                  |                  |
        Behavioral          Visual          Determinism
         Verifier           Verifier          Verifier
             |                  |                  |
             +------------------+------------------+
                                |
                       Divergence Analyzer
                                |
                      PASS / evidence loop
```

---

# Agent contracts

Every agent returns structured output equivalent to:

```ts
interface AgentResult<T> {
  status: "success" | "partial" | "blocked" | "failed";
  output: T;
  evidence: EvidenceRef[];
  assumptions: Assumption[];
  warnings: Warning[];
  confidence: number;
  nextActions: NextAction[];
}
```

Assertions must be explicitly classified:

```text
OBSERVED
DERIVED
HYPOTHESIS
VERIFIED
REJECTED
UNKNOWN
```

No assumption may silently become a fact.

---

# Evidence lifecycle

```text
UNKNOWN
   |
CANDIDATE
   |
HYPOTHESIS
   |\
   | REJECTED
   v
SUPPORTED
   |\
   | REJECTED
   v
VERIFIED
```

Suggested rules:

- CANDIDATE: at least one observation.
- HYPOTHESIS: semantic interpretation + falsifiable prediction.
- SUPPORTED: at least two independent evidence types.
- VERIFIED: reproduced by an independent verifier in a deterministic experiment.

Only `SUPPORTED` or `VERIFIED` semantics may automatically feed source generation in faithful mode.

---

# Isolation rules

The Skeptical Reviewer must not inherit the Semantic Analyst's hidden reasoning narrative.

It receives only:
- explicit claim
- persisted evidence
- addresses
- traces
- reproducible experiments

The reviewer should try alternative explanations, for example when testing a candidate `player.position.x`:

```text
camera X?
sprite render X?
previous-frame X?
collision probe X?
world X?
```

The verifier evaluates observable behavior, never how convincing generated code looks.

---

# Evidence store

Use SQLite initially.

Do not add a graph DB until queries prove it necessary.

Conceptual evidence relations:

```text
function A --calls--> function B
function A --writes--> memory X
memory X --correlates-with--> player.x
trace T --executes--> function A
scenario S --produces--> trace T
```

Every evidence item should include provenance.

Example:

```yaml
symbol: player.position.x
source_address: 0x000291A0
confidence: 0.94
evidence:
  - type: memory_correlation
    scenario: walk_right_120_frames
  - type: xref
    function: candidate_update_player
  - type: controlled_experiment
    scenario: patch_candidate_x
```

---

# Static RE adapter

Canonical interface is Ghidra headless analysis, not MCP.

Initial exported snapshot:

```ts
interface StaticAnalysisSnapshot {
  program: {
    format: string;
    languageId: string;
    imageBase: string;
  };
  memoryBlocks: MemoryBlock[];
  functions: StaticFunction[];
  xrefs: Xref[];
  strings: StaticString[];
  symbols: StaticSymbol[];
  hardwareAccessCandidates: HardwareAccess[];
}
```

Each function should expose enough evidence for agents:

```ts
interface StaticFunction {
  address: string;
  ghidraName: string;
  size: number;
  callers: string[];
  callees: string[];
  reads: MemoryAccess[];
  writes: MemoryAccess[];
  disassembly: string;
  decompilation?: string;
}
```

Decompiler output is evidence, not ground truth.

---

# Runtime adapter

Initial oracle: Amiberry.

Desired adapter operations:

```text
boot
load savestate
save savestate
pause
resume
step frame
step instruction
read memory
write memory
read registers
set breakpoint
set watchpoint if supported
capture CPU trace if supported
capture memory snapshot
capture framebuffer
inject input
query chipset state
```

Known Phase 0 gaps to validate rather than assume:

- stable programmatic watchpoints
- instruction trace streaming
- deterministic joystick injection
- CI without graphical display server

Use keyboard-driven fixture input initially if that is the most stable automation path.

---

# Compatibility Doctor

Compatibility warnings must be data-driven and community-extensible.

Example rule:

```yaml
id: amiga.self_modifying_code
severity: high
category: static-analysis

match:
  executable_region_written_at_runtime: true

message: Self-modifying code detected.
impact: Static decompilation may not represent executed code.
recommendation:
  - capture runtime code after modification
  - analyze the resulting memory image

capabilities:
  static_analysis: degraded
  generation: blocked_until_runtime_capture
```

Initial warning catalog must include at least:

```text
amiga.input.not_hunk
amiga.cpu.unsupported
amiga.executable.packed
amiga.executable.overlays
amiga.memory.self_modifying
amiga.runtime.generated_code
amiga.chipset.direct_hardware_access
amiga.copper.detected
amiga.blitter.detected
amiga.timing.beam_polling
amiga.timing.cycle_exact
amiga.protection.custom_loader
```

Project support classifications:

```text
SUPPORTED
SUPPORTED_WITH_WARNINGS
PARTIAL
REQUIRES_MANUAL_RE
REQUIRES_HARDWARE_EMULATION
UNSUPPORTED
UNKNOWN
```

The system must prefer honest limitation over fake conversion success.

---

# v0.1 Semantic IR

Do NOT attempt a universal game IR yet.

Use the smallest structure necessary to prove the architecture:

```ts
interface HorizontalMovementIR {
  tick: {
    unit: "frame";
    rateHz: number;
  };
  position: {
    bits: 16;
    signed: true;
  };
  velocity: {
    bits: 16;
    signed: true;
  };
  inputMapping: {
    left: number;
    idle: number;
    right: number;
  };
  updateOrder: ["read-input", "set-velocity", "apply-velocity"];
}
```

Unknown fields remain unknown. Never guess to satisfy a schema.

---

# Target TypeScript rules

Generated simulation must be deterministic and rendering-independent.

Initial package does not need Phaser.

Later target structure:

```text
src/
├── simulation/
│   ├── game-loop.ts
│   ├── fixed-point.ts
│   ├── input.ts
│   ├── player.ts
│   ├── physics.ts
│   ├── collision.ts
│   ├── camera.ts
│   └── rng.ts
├── rendering/
│   └── phaser/
├── audio/
├── generated/
└── debug/
```

Phaser is a rendering/runtime adapter only. Do not let Phaser Physics replace reconstructed gameplay logic unless verified equivalent.

---

# Differential verification

For the same logical input scenario:

```text
reference emulator
        vs
TypeScript simulation
```

Compare state every tick.

The most useful result is the FIRST divergent tick.

Example:

```text
frame 183

reference:
  x = 412
  velocityX = 3

port:
  x = 413
  velocityX = 3
```

Divergence Analyzer should route the issue to:

- reverse engineering if evidence is missing
- semantic reconstruction if interpretation is wrong
- target port if implementation is wrong

Do not patch visible symptoms before finding the first causal divergence.

---

# Suggested monorepo

```text
retroport/
├── apps/
│   └── cli/
├── packages/
│   ├── core/
│   ├── schemas/
│   ├── evidence/
│   ├── compatibility/
│   ├── source-amiga-hunk/
│   ├── static-ghidra/
│   ├── runtime-amiberry/
│   ├── agents/
│   ├── semantic-ir/
│   ├── target-typescript/
│   └── verification/
├── fixtures/
│   └── amiga-m68k-horizontal/
├── compatibility/
│   └── amiga/
├── docs/
└── tests/
```

Persistent local state later:

```text
.retroport/
├── project.yaml
├── capabilities.yaml
├── evidence.db
├── hypotheses/
├── experiments/
├── traces/
├── semantic-ir/
├── generated/
├── reports/
└── agent-runs/
```

---

# Immediate implementation order

Do this in order and keep the first vertical slice extremely small:

```text
1. scaffold pnpm monorepo
2. define shared schemas
3. implement Evidence and Warning types
4. implement compatibility registry loader
5. create RetroPort MicroFixture source/build
6. produce stripped HUNK artifact
7. create `retroport inspect`
8. create Ghidra headless export script
9. parse static export into Evidence Store
10. implement Amiberry runtime adapter
11. implement deterministic LEFT/RIGHT/IDLE scenario runner
12. persist runtime observations
13. create Semantic Analyst protocol
14. create isolated Skeptical Reviewer protocol
15. implement controlled candidate-X memory experiment
16. implement Evidence Gate
17. emit HorizontalMovementIR
18. generate deterministic TypeScript implementation
19. run differential verification
20. reveal fixture ground truth and grade reconstruction
```

Do NOT start Superfrog until this passes.

---

# First coding milestone

The first PR/milestone should only establish the repo skeleton and contracts.

Recommended contents:

```text
pnpm-workspace.yaml
package.json
tsconfig.base.json

apps/cli/
packages/schemas/
packages/evidence/
packages/compatibility/
packages/core/
fixtures/amiga-m68k-horizontal/
```

Implement:

```ts
ProjectManifest
CapabilityMatrix
CompatibilityWarning
EvidenceRecord
AgentResult<T>
Hypothesis
Experiment
HorizontalMovementIR
```

Also implement a data-driven compatibility-rule loader plus a few unit tests.

Do not integrate Ghidra or Amiberry in the first commit unless the schemas/contracts are already clean.

---

# Coding style / design constraints

- TypeScript-first.
- Keep core provider-neutral.
- Prefer small explicit interfaces over framework magic.
- Use dependency inversion for Ghidra/emulator/model adapters.
- Avoid premature graph-database complexity.
- Avoid universal Semantic IR design before real evidence demands it.
- Avoid generic `any` in public contracts.
- Runtime schemas must validate external/tool outputs.
- Tests should target deterministic behavior.
- Persist observable agent inputs/outputs/tool results, not hidden chain-of-thought.
- Avoid vendor-specific model names in core packages.
- Every automatic conclusion should point to Evidence IDs.

---

# Non-goals for v0.1

Do not implement yet:

- Superfrog conversion
- ADF/IPF ingestion
- WHDLoad
- packer/cruncher support
- overlays
- self-modifying code recovery
- cycle-perfect reproduction
- full graphics extraction
- sound/music reconstruction
- enemies
- tilemaps
- full Phaser game runtime
- universal m68k-to-TypeScript compiler
- arbitrary legacy platforms

---

# Useful upstream projects/references

Research identified these as relevant:

- Ghidra Headless Analyzer
  https://github.com/NationalSecurityAgency/ghidra/blob/master/Ghidra/RuntimeScripts/support/analyzeHeadlessREADME.md

- Amiga support for Ghidra
  https://github.com/BartmanAbyss/ghidra-amiga

- Amiberry IPC
  https://github.com/BlitterStudio/amiberry/wiki/IPC-Socket-support

- Amiberry automation/MCP server
  https://github.com/BlitterStudio/amiberry-mcp-server

- Amiga reverse-engineering workflow reference
  https://github.com/kermitfrog/Amiga-Re-Engineering

- External Amiga fixture candidate
  https://github.com/neildavis/amiga_asmdev_workflow

- Open/free real-game candidate for later
  https://blockyskies.com/

- EWGM source for later integration testing
  https://github.com/alpine9000/EWGM

---

# Codex starting instruction

Use the following as the task for the first implementation pass:

> You are implementing RetroPort AI v0.1 from this handoff. Start with the repository skeleton and foundational contracts only. Create a pnpm TypeScript monorepo with `apps/cli`, `packages/core`, `packages/schemas`, `packages/evidence`, and `packages/compatibility`, plus the placeholder `fixtures/amiga-m68k-horizontal` directory. Implement strongly typed and runtime-validated schemas for ProjectManifest, CapabilityMatrix, CompatibilityWarning/Rule, EvidenceRecord, AgentResult, Hypothesis, Experiment, and HorizontalMovementIR. Implement a filesystem-backed compatibility rule registry that loads YAML rules and validates them before use. Add a minimal `retroport doctor` command that can evaluate a synthetic ProjectManifest against rules and print SUPPORTED / SUPPORTED_WITH_WARNINGS / PARTIAL / REQUIRES_MANUAL_RE / REQUIRES_HARDWARE_EMULATION / UNSUPPORTED / UNKNOWN. Add Vitest tests. Do not integrate Ghidra, Amiberry, an LLM provider, Phaser, or Superfrog yet. Keep all external systems behind interfaces so later adapters can be added without changing core contracts. After implementing, document architecture decisions and identify any contract that you believe should change before the Ghidra/Amiberry vertical slice.

