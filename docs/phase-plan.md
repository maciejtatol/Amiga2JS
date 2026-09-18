# Conversion phase plan

## Readiness review

The current engine converts a validated Amiga HUNK executable after static and
runtime evidence has been supplied. It does not yet convert a floppy image.
An ADF is a disk container, not the executable artifact consumed by the HUNK
preflight and Ghidra boundary.

The local `ADF games/Superfrog` directory contains four images. Disks 1 and 3
start with `DOS\0` boot code and contain a Copylock marker; disks 2 and 4 start
with packed/raw `ATN!` data. None of the images has a usable standard AmigaDOS
root block at block 880, so the set must be treated as bootable/protected until
an Amiga-aware tool or emulator confirms how its contents are exposed. Disk 3
is also only 889,856 bytes (1,738 sectors), rather than the normal 901,120-byte
double-density geometry. The current `retroport inspect` command rejects these
files intentionally because it accepts HUNK artifacts only.

This is a feasibility signal, not a successful conversion. The four local
files are enough to plan a multi-disk intake, but not enough to claim that the
set is complete, coherent, or directly extractable.

## Choosing among dump variants

The current local files have these SHA-1 values:

```text
Superfrog_1.adf  d042ecdd24dec61f7823dd322f0a2314d06bc2d1
Superfrog_2.adf  c5528eac0c09fed318cb25fa8d75069b780e44f0
Superfrog_3.adf  28ce1f66b3bec85826c7bf3cc967ba27cc2a398c
Superfrog_4.adf  f5ef23973fb5d5822224738aceda0091e795382c
```

Only disks 2 and 4 match the hashes listed by OpenRetro for its four-disk
[TOSEC `ADF, cr CSL` variant](https://openretro.org/amiga/superfrog/edit).
Disks 1 and 3 differ, and disk 3 is truncated, so this directory should be
treated as a mixed or damaged set rather than a conversion baseline. For the
first practical experiment, obtain a single coherent four-disk set with no
additional trainer or hack flags:

```text
Superfrog ... (Disk 1 of 4)[cr CSL]
Superfrog ... (Disk 2 of 4)[cr CSL]
Superfrog ... (Disk 3 of 4)[cr CSL][bootable]
Superfrog ... (Disk 4 of 4)[cr CSL]
```

This is the easiest baseline because it avoids trainer patches and alternate or
incomplete dumps, while remaining likely to boot in an emulator. It is still a
cracked image, so it is not suitable as the canonical original-code reference.

For fidelity and preservation, prefer a verified original IPF set when rights
and tooling allow it. The [OpenRetro IPF record](https://openretro.org/amiga/superfrog/edit)
lists a separate three-image variant (Disk One, Disk Two, and Story Disk),
demonstrating that “four-disk ADF” and “IPF set” are not necessarily the same
release layout. Do not mix disks between these variants.

The [TOSEC naming convention](https://www.amigaeu.com/pages/tosec-naming-convention.php)
defines `[cr]` as cracked, `[b]` as bad dump, `[h]` as hacked, `[t]` as trained,
`[a]` as alternate, and `[u]` as underdump. Numbered forms such as `[a2]` and
`[u2]` identify additional variants, not extra disks. The CD32 entry is a
separate 1994 platform build and should be a later target, not a substitute for
the Amiga floppy set.

## Phases and gates

### 1. Disk intake and provenance

Status: the first intake slice is implemented in
`@retroport/source-amiga-adf` and exposed as `retroport inspect-adf`. It
records geometry, boot/root-block signals, detected markers, and SHA-1/SHA-256
digests without treating disk bytes as an executable. Multi-disk manifest
validation is available through `inspect-adf-set`, and
`write-adf-manifest` persists the versioned provenance record. Emulator-backed
executable extraction remains pending.

- Keep ADF/IPF/HDF and other commercial media outside Git.
- Record filename, byte length, SHA-256, source/provenance, license status, and
  dump/tool metadata in a checked-in manifest.
- Detect image geometry, bootability, filesystem type, and protection markers.
- Produce a normalized disk artifact record without claiming that it is a HUNK.

Gate: every local image has a reproducible digest and an explicit legal and
format status; unsupported formats produce warnings rather than false success.

### 2. Executable extraction

Status: extraction planning is implemented via `plan-adf-extraction`, and
`record-adf-extraction` now creates a parent-disk-linked artifact record. HUNK
records are decoded and structurally preflighted before they are recorded;
actual AmigaDOS file extraction and emulator-assisted memory/loader capture
remain pending.

- Add an Amiga disk-image adapter for filesystem extraction where possible.
- Fall back to emulator-assisted boot capture for custom loaders, packed code,
  or protected disks.
- Persist the extracted executable(s) as content-addressed artifacts and retain
  the parent disk digest and extraction method.
- Run HUNK preflight only on extracted HUNK candidates.

Gate: each analyzed executable has a traceable parent disk and extraction
record, and analysts can distinguish disk bytes from executable bytes.

### 3. Multi-disk orchestration

Status: ordered-set discovery and pre-extraction validation are available via
`retroport inspect-adf-set`. The Amiberry runtime boundary now exposes typed
insert/eject/query disk operations, and validated disk-swap journals can be
replayed deterministically. Live emulator event capture remains pending.

- Model a disk set with stable set ID, ordered disk IDs, labels, boot disk,
  required Kickstart/configuration, and per-disk hashes.
- Capture disk insert/eject/swap requests as timestamped or frame-aligned
  evidence.
- Let the Amiberry adapter mount the correct disk and resume deterministic
  capture after a swap.
- Reject incomplete or ambiguously ordered sets before conversion.

Gate: the same disk set and scenario sequence can be replayed deterministically,
including every required media change.

### 4. External evidence pipeline

- Run Ghidra against extracted HUNK candidates and normalize its snapshot.
- Capture Amiberry observations through `retroport capture`.
- Run `retroport phase0-captured` so reconstruction, review, generation,
  verification, grading, and reproducibility manifests share one path.
- Record blocked outcomes for unsupported packed/self-modifying or unresolved
  runtime behavior.

Gate: no semantic claim is accepted without linked static/runtime evidence and a
passing independent verification report.

### 5. Fixture ladder and ground truth

- First test the authored MicroFixture (already passing).
- Add a redistributable stripped external fixture with private ground truth.
- Use the Superfrog disk set only as a local integration target while rights,
  extraction, protection, and multi-disk behavior are being assessed.
- Promote an open-source multi-disk fixture to CI once licensing and tooling are
  settled.

Gate: CI uses redistributable fixtures; proprietary images remain opt-in local
inputs and never become required test dependencies.

## What additional ROMs/disks should include

For each example, provide the complete set when available, original disk order,
image format (ADF/IPF/HDF), region/version, SHA-256 values, provenance/license,
and any known emulator configuration. A single disk is still useful for intake
and protection detection, but it is not enough to validate a multi-disk
conversion workflow.

## Reference tooling

- [ADFlib](https://github.com/adflib/ADFlib) can open standard DD/880 KiB and HD
  ADF images, access OFS/FFS volumes, and extract files with its `unadf`
  utility. Use it first for ordinary AmigaDOS disks, but keep its filesystem
  result separate from the raw disk artifact.
- [Amiberry IPC](https://github.com/BlitterStudio/amiberry/wiki/IPC-Socket-support)
  exposes pause/frame control plus `INSERTFLOPPY`, `EJECT_FLOPPY`, `DISKSWAP`,
  and `QUERYDISKSWAP`, which is the runtime basis for deterministic multi-disk
  capture.
- [WHDLoad's installation guide](https://www.whdload.de/docs/en/howto.html)
  documents the practical fallback for NDOS games: locate the loader in the
  boot block, rip the main executable or a memory dump, and handle non-standard
  trackloaders with RawDIC-style tooling. It also describes why multi-disk
  access must be redirected per disk.
- [Ghidra Amiga](https://github.com/BartmanAbyss/ghidra-amiga) loads Amiga HUNK
  executables; it is an analysis stage after extraction, not an ADF unpacker.
