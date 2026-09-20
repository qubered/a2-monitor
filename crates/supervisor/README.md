# Native worker supervisor

This crate owns the deterministic, platform-neutral worker lifecycle state
machine for the audio node. It starts each configured worker with a node boot ID
and monotonically increasing generation, fences cross-boot and stale-generation
events, requires role-specific readiness evidence, applies a bounded restart
budget, quarantines only the failing worker, and gives shutdown requests a fixed
grace period before forced termination. Ready workers must send strictly
increasing heartbeat sequence numbers before a configured deadline. A
forced-termination adapter may return success only after it has confirmed
process death; otherwise the supervisor retains the handle and never starts a
replacement. Failed termination calls retry with a configured exponential delay
and cap. Exhausting the finite attempt budget leaves the worker visibly
`TerminationStuck`, retains its possibly-live handle, and requires external exit
confirmation rather than pretending shutdown succeeded.

Audio capture epochs are nonzero and monotonically increasing within one node
boot. This bounded rule rejects replay of any earlier epoch without retaining an
unbounded set. A new supervisor boot ID resets the epoch namespace.

The constructor accepts a partial topology during scaffold development, so
`WorkersReady` means every configured worker is ready, not that a deployable
node has every mandatory role. Audio engine, sequencer, client gateway and
replay are singleton roles. Media and receiver-adapter roles may be configured
more than once for explicit failure shards. Deployment topology validation
remains future integration work.

The closed scaffold inventory in
`infra/appliance/common/process-boundaries.v0.json` assigns every native role a
cardinality, readiness requirement and canonical configuration order. A Rust
parity test rejects drift from the `WorkerRole` catalogue. The order is audio
engine, sequencer, replay, media shards, receiver-adapter shards, then client
gateway; shutdown requests run in reverse. `start()` still attempts every
configured worker immediately, so this is not dependency-gated startup. The
contract deliberately marks all six native entries `policy-model-only` and is
not converted into runnable `WorkerSpec`s.

The process and clock boundaries are injected. Platform launchers will implement
the process boundary with restricted Windows children or launchd/XPC connections
after those mechanisms have evidence. This scaffold does not claim OS
confinement, privilege separation, signal delivery, or production health IPC.

Run the focused checks from the repository root:

```sh
cargo test -p a2-supervisor
cargo clippy -p a2-supervisor --all-targets -- -D warnings
cargo run --locked --bin a2-supervisor-smoke
```
