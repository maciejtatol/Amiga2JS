# @retroport/runtime-amiberry

Provider-neutral runtime contracts for Amiberry automation. The package
validates executable loading, frame-aligned observations, state-patch
experiments, and floppy media operations without requiring Amiberry in CI.

Multi-disk evidence is represented as versioned `DiskSwapJournal` events. Each
event has a frame tick, drive, action, and content-addressed disk artifact.
`normalizeDiskSwapJournal` rejects out-of-order or ambiguous same-drive events;
`replayDiskSwapJournal` pauses the oracle, advances to each event boundary, and
records the normalized disk state after every operation.
