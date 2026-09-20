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

This is not an OS shared-memory implementation. The serialized ABI model is
intentionally single-threaded. A separate preallocated in-process SPSC model
uses atomic metadata and sample-bit storage to exercise concurrent publication,
overwrite-oldest gaps and pattern integrity without changing the serialized
model's `Send`/`Sync` boundary. If the consumer has claimed the exact victim
slot, the producer returns a successful, terminal drop-newest outcome containing
the incoming source sequence and frame range instead of waiting or requiring a
caller retry. Publication sequences remain contiguous; source sequences remain
distinct and may contain gaps. Successful overwrites identify the exact victim
source and frame range. It does not prove cross-process atomic layout,
memory-order, cache-coherency or crash behavior. Platform code must separately
provide authenticated handles, least-write views, safe byte-level slot claims,
cleanup and confinement before this layout is used between processes.

Run the focused checks with:

```sh
cargo test -p a2-pcm-abi --locked
cargo clippy -p a2-pcm-abi --all-targets --locked -- -D warnings
```
