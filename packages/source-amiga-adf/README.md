# @retroport/source-amiga-adf

Small ADF intake boundary. It reports image geometry, boot
signatures, the conventional AmigaDOS root block, content-kind warnings,
protection/packer markers, and reproducible SHA-1/SHA-256 digests.

`inspectAdfSet` and the `retroport inspect-adf-set` command additionally check
disk numbering, missing/duplicate members, and consistent image geometry.

`createAdfSetManifest` produces a versioned JSON contract containing the set's
provenance, per-disk digests, inspection results, and validation issues.

`planAdfExtraction` explicitly distinguishes filesystem extraction from images
that require emulator-assisted loader capture. It never labels raw disk bytes
as an executable.

`createAdfExtractionRecord` links an extracted artifact to its parent disk
digest, extraction method, format, size, and artifact digest.

`AdfLibFilesystemExtractor` provides an injectable boundary for ADFlib's
`unadf` command. It creates the destination directory, runs extraction only
for a conventional AmigaDOS inspection, and returns a versioned invocation
record with a sorted inventory of extracted files, byte lengths, and SHA-256
digests for later artifact selection.

This package deliberately does not unpack custom loaders or claim that an ADF
is a HUNK executable. Extraction remains a later Amiga-aware or emulator-
assisted phase.
