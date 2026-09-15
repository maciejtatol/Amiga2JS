# @retroport/source-amiga-adf

Small, dependency-free ADF intake boundary. It reports image geometry, boot
signatures, the conventional AmigaDOS root block, content-kind warnings,
protection/packer markers, and reproducible SHA-1/SHA-256 digests.

This package deliberately does not unpack custom loaders or claim that an ADF
is a HUNK executable. Extraction remains a later Amiga-aware or emulator-
assisted phase.
