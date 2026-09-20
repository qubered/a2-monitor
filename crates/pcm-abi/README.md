# A2 shared PCM ABI model

This zero-dependency crate owns the checked, little-endian descriptor/region
layout, consumer-control-page bytes, and deterministic state-machine model for
page-separated shared PCM rings. Producer-state, diagnostic and slot-header byte
fields are not frozen yet.

The model allocates all storage during construction. Publication performs no
allocation, lock, wait, I/O or logging. Producer-owned sequence numbers select
slots; consumer-controlled bytes can report progress but never address memory.
Invalid version, generation, epoch or cursor state produces a bounded fault or
remap result. Overflow keeps the producer live and reports the exact overwritten
sequence range.

This is not an OS shared-memory implementation. The model is intentionally
single-threaded and does not prove concurrent access to ordinary sample memory.
Platform code must separately provide authenticated handles, least-write views,
safe slot-claim/race behavior, cleanup and confinement before this layout is
used between processes.

Run the focused checks with:

```sh
cargo test -p a2-pcm-abi --locked
cargo clippy -p a2-pcm-abi --all-targets --locked -- -D warnings
```
