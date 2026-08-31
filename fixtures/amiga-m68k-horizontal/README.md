# Amiga m68k horizontal movement fixture

Repository-owned Phase 0 micro-fixture. `source.json` is the public deterministic
input, `build-stripped.hunk.hex` is the checked-in stripped HUNK artifact, and
`manifest.json` records its SHA-256 digest. The tiny program models one horizontal
movement state encoding for LEFT, RIGHT, or NONE input. Each modeled tick applies
exactly -2, +2, or 0 to `playerX`; positions and velocity use signed 16-bit
wraparound, while `tickCounter` is an unsigned 32-bit counter. The HUNK is a
synthetic encoded fixture for parser/reconstruction tests, not an executable
Amiga program or a claim of native CPU behavior.
Private ground truth is not included.

Run `npm run build:fixture -w @retroport/source-amiga-hunk` to regenerate the
artifact and manifest. The parser intentionally validates only this minimal
synthetic single-code-hunk shape; it is not a general Amiga HUNK linker/parser.

The builder and strip pipeline live in `@retroport/source-amiga-hunk`.
