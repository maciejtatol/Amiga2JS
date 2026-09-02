# RetroPort Ghidra exporter

`RetroPortSnapshot.java` is the deterministic headless exporter used by the
`@retroport/static-analysis` boundary. It emits one machine-readable line:

```text
RETROPORT_SNAPSHOT=<validated JSON>
```

Run it with a pinned Ghidra installation (the Phase 0 handoff targets Ghidra
12.0.1):

```sh
/path/to/ghidra/support/analyzeHeadless \
  /tmp/ghidra-projects amiga-fixture \
  -import /path/to/amiga-m68k-horizontal.hunk \
  -postScript /path/to/Amiga2JS/tools/ghidra/RetroPortSnapshot.java
```

The exporter keeps Ghidra logs separate from the marker line, sorts every
collection deterministically, and treats decompiler output as optional
evidence. The hardware candidate list stays empty until a target-specific
address map is explicitly supplied; this avoids inventing hardware semantics.

Ghidra and the Amiga loader are external tools and are intentionally not
bundled in the project Docker image.
