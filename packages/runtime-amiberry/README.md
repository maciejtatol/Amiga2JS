# @retroport/runtime-amiberry

Provider-neutral runtime contracts for Amiberry automation. The package
validates executable loading, frame-aligned observations, state-patch
experiments, and floppy media operations without requiring Amiberry in CI.

Multi-disk evidence is represented as versioned `DiskSwapJournal` events. Each
journal records its initial mounted state and each subsequent event has a frame
tick, drive, action, and content-addressed disk artifact.
`normalizeDiskSwapJournal` rejects out-of-order or ambiguous same-drive events;
`replayDiskSwapJournal` pauses the oracle, advances to each event boundary, and
records the normalized disk state after every operation.

`captureScenarioWithDiskSwaps` combines regular runtime observations with this
journal by polling disk state after every frame boundary.

Adapters that expose an event stream can write the versioned
`runtimeCaptureLogSchema` envelope and pass it to `ingestRuntimeCaptureLog`.
The importer sorts observations by frame, validates that one scenario and one
initial disk state are represented, and emits the same `DiskSwapCapture` shape
used by live polling. This keeps replay and Phase 0 independent from the
transport that produced the events.
