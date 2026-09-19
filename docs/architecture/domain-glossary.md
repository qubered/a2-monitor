# Stable domain glossary and identifiers

**Status:** Normative naming baseline

| Term / ID | Meaning and lifetime |
| --- | --- |
| Production / `production_id` | Long-lived reusable body of show material and policy; never a dated performance. |
| Show revision / `show_revision_id` | Immutable, content-addressed release of production definitions; runtime changes never increment it. |
| Performance / `performance_id` | One dated rehearsal/show instance with its own runtime history. |
| Activation / `activation_id` | Node prepare/commit result binding one show revision and hardware manifest to one performance/authority epoch. |
| Performance overlay / `overlay_id`, `overlay_revision` | Runtime cast/mic/path intent for a performance, independent of the immutable show revision. |
| Physical assignment / `assignment_id`, `assignment_revision` | Bitemporal fact relating performer/role/assets/path over an effective interval. |
| Authority epoch / `authority_epoch` | Fixed-width 128-bit fencing/order token allocated only after safe takeover rules. |
| Lease / `lease_id` | Short-lived capability for one user/client key/node boot/performance/epoch; not a login session. |
| Cue definition / `cue_definition_id` | Reusable planned cue/scene with absolute expected-state snapshot. |
| Cue occurrence / `cue_occurrence_id` | Unique runtime observation/action; repeats and backs create new occurrences. |
| Event / `event_id` | Immutable fact emitted by an authority; projections may be rebuilt or corrected without altering it. |
| Export / `export_id` | Immutable manifest identity for one produced package; repeated exports get new IDs even if content hashes match. |

All IDs are UUIDs unless a contract explicitly declares a content hash, sequence
string or authority-epoch string. Display names, cue labels, receiver channel
numbers and audio-input labels are never identifiers. “Show” in UI copy may mean
the active performance, but APIs and documents must use the exact term above.
