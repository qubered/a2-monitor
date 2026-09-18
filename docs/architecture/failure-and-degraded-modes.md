# Failure and degraded-operation contract

**Status:** Proposed release contract

The product is an advisory monitoring system, not part of the programme audio
or performer-monitor path. A conventional console/headphone monitoring path is
the required fallback whenever this product is unavailable.

## Show-time control lease

After backend authentication, Live receives a signed, node-scoped control lease
bound to the user, active show revision, authority epoch, media session,
permissions, expiry, nonce, and client key/fingerprint. Live then sends the
small set of show-time
commands through the backend to the active-node sequencer while healthy. During
a backend interruption, the same leased listen routing, personal gain/pan/dim,
replay, cue and approved emergency-swap commands can reach the node's
unprivileged client gateway directly. Manager operations and edits to the
immutable show definition always go through the backend.

This preserves useful control for an established Live session during a short
backend outage without adding a node management UI. A lease has a configured
show-length maximum, can use only the activated alternatives/spare pool, is
replay protected, and is revoked when connectivity exists. It cannot create
people/assets or make arbitrary bindings. Offline revocation is not possible;
that tradeoff is visible in the security model.

## Failure matrix

Targets below are proposed until measured on reference hardware.

| Failure | Automatic behavior | Operator capability | Proposed target |
| --- | --- | --- | --- |
| Public internet loss | No local service changes. | Full local operation. | Indefinite. |
| Backend process restart | Node keeps capture, replay, receiver state, media, active performance and valid leased controls. Appliance service manager restarts backend. | Existing Live sessions can listen, replay, move cues and perform approved emergency swaps; Manager, collaboration and new sessions wait. | Backend healthy and control ledger reconciled within 30 s. |
| Collaboration database unavailable/corrupt | Stop accepting mutations before acknowledgement; preserve node/audio priorities. Isolate or restore the database. | Intercom/radio plus emergency paper log; monitoring and leased node commands continue. | No accepted commit lost; recovery/restore RTO is validated separately from process restart. |
| Metadata disk full | Reserve control/database space, reject uploads/chat first, then nonessential state; never consume audio/replay reservations. | Monitoring continues; collaboration may be read-only/unavailable. | Warn before reserve; accepted commit RPO 0. |
| Asset store/worker unavailable | Text/state continues; new attachments remain unavailable or visibly processing, never ready. | Use text/intercom; existing ready assets show explicit failure if missing. | No false ready/attachment delivery; worker RTO does not gate monitoring. |
| Migration/startup failure | Backend stays unavailable/previous compatible version remains active; no partial schema use. | Existing leased sessions continue; Manager/new sessions wait. | Rollback or repair runbook; target validated per migration. |
| Collaboration overload | Admission limits shed pages/chat, then attachments/transcription according to resource priority. | Intercom/radio authoritative; capture/live media remain healthy. | Zero callback impact; clear rejection/retry status. |
| Browser reload during backend outage | Existing media session is lost; no credential is persisted solely to bypass auth. | Reconnect waits for backend recovery. | Clear offline screen; backend recovery target applies. |
| Client Wi-Fi roam/drop | Node preserves bus briefly; ICE restart/reconnect is attempted. | Other clients unaffected. | Recover within 5 s on validated roaming profile. |
| Audio device loss | Close epoch, mark audio unavailable, keep receiver telemetry, retry exact device only. | RF diagnosis remains; listening is silent/unavailable, never stale. | Detect within 1 s; recovery measured per driver. |
| Audio engine crash | Supervisor restarts engine; never substitutes another device. | UI declares monitoring unavailable and directs operator to fallback. | Cold recovery target <= 120 s, then identity reconciliation. |
| Receiver adapter crash | Only affected vendor/device telemetry goes stale; audio continues. Worker restarts with bounded backoff. | Listening and PCM meters remain. | Stale indication <= 1 s; worker recovery <= 10 s when device is reachable. |
| Receiver/network loss | Preserve last value as stale with timestamp; no inferred healthy state. | Audio continues. | Immediate visible degradation after configured freshness threshold. |
| Replay writer/disk failure | Drop replay work, protect capture and live media, shrink/disable replay. | Live monitoring continues. | Never block audio callback. |
| Node/backend partition | Node continues active revision/overlay; canonical runtime mutations enter the non-evicting control ledger while bounded telemetry may roll over. | Existing leased Live sessions continue; only activated-pool runtime mutations are allowed until durable mutation reserve is reached. | Reconcile idempotently; stop mutations before control-history loss. |
| Certificate nearing expiry | Warn before the show and block unsafe activation if expiry falls inside the planned show window. | Existing valid session follows its lease. | Renewal tested offline; no surprise show-time expiry. |
| Appliance power loss | UPS initiates clean shutdown when possible; active segment may be lost. | External fallback only until reboot. | Completed replay segments and show database recover; boot target <= 120 s. |

## Reconciliation after recovery

The backend sends its intended show revision, authority epoch and last
acknowledged control sequence. The node reports its active revision/epoch,
overlay revisions, observed hardware manifest, timeline epochs, lease/session
set, control-ledger checkpoint/tail and telemetry-journal range. Mismatched
authority epochs or overlays never merge silently. The backend imports the
canonical node sequence idempotently and verifies its checkpoint hash.

The operator may retain observed state, stop the show, or activate a new
prepared revision/authority epoch. A choice that would supersede an offline
physical swap is prohibited until the affected performer, pack, receiver/path
and input are physically verified against the emergency log. “Reactivate
intended” is never a blind relabeling operation.

Chat is not reconstructed from node events. After recovery, the backend resumes
each conversation from its durable server sequence; clients retry only messages
with stable idempotency IDs and display acceptance status. Presence is rebuilt
from live sessions and is allowed to expire rather than being replayed.

## Required runbooks and evidence

Each row needs a test script containing trigger, expected automatic behavior,
operator action, safe fallback, RTO/RPO, and recovery proof. Release evidence
includes repeated cold starts, power cycles, backend and worker crash loops,
disk-pressure tests, clock/NIC/device changes, AP roaming, certificate expiry,
and spare-appliance restore.
