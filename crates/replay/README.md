# Replay ring model

`a2-replay` is the deterministic, preallocated in-memory model for the rolling
replay timeline. It proves bounded slot retention, exact frame/epoch ordering,
overwrite and source-gap reporting, bounded independent readers, and slow-reader
cancellation without making reader progress part of the writer path.

Construction binds a nonzero node boot, capture session, ring generation,
sample rate and channel/block limits. Append and read paths allocate no memory
after construction. Retained-window results report actual block and frame
endpoints; configured block capacity is not presented as a guaranteed duration.
The state model is capped at 128 channels, 4,096 frames per block, 65,536
blocks, 64 readers and 256 MiB of preallocated slot storage. Frame intervals
use a representable half-open end, so a block starting at `u64::MAX` is rejected.
Writer loss requires a new ring generation; the existing generation cannot
reattach a writer with ambiguous state.

This crate is deliberately single-threaded. It does not implement the durable
segmented file format, append-only index, checksums, recovery scan, disk-space
reservation, encryption, OS process isolation, concurrent handoff, or a
capture-callback queue. Those require the Phase 0B-A storage ADR, worker wiring,
fault injection and named-host measurements.

Run focused checks with:

```sh
cargo test -p a2-replay --locked
cargo clippy -p a2-replay --all-targets --locked -- -D warnings
```
