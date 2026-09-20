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

The crate also includes a serialized, preallocated ingress state-machine model
for one capture epoch. It validates before mutation, keeps capture and ingress
sequences distinct, drops the oldest unwritten block on queue pressure, and
publishes persistent exact loss ranges before surviving audio. Drain uses
peek/commit so a failed downstream append does not consume work. Source gaps
travel with their queued block. If the bounded exact-loss ledger cannot
represent another non-contiguous range, ingress fences replay and retains the
rejected block metadata instead of erasing or fabricating evidence; composition
must rotate to a fresh ingress generation.

This crate is deliberately single-threaded. It does not implement the durable
segmented file format, append-only index, checksums, recovery scan, disk-space
reservation, encryption, OS process isolation, or concurrent handoff. The
ingress model does not prove a capture-callback transport. Those require the
Phase 0B-A storage ADR, worker wiring, fault injection and named-host
measurements.

A cross-crate test composes the separate in-process atomic SPSC model from
`a2-pcm-abi` with replay ingress and the replay ring. It verifies that exact
transport loss is observed before surviving patterned PCM, then reads the same
PCM back through a replay reader. This remains model composition, not a worker,
OS mapping, durable store or callback-deadline result.

Run focused checks with:

```sh
cargo test -p a2-replay --locked
cargo clippy -p a2-replay --all-targets --locked -- -D warnings
```
