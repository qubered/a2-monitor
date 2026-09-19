# Phase capability and dependency matrix

**Status:** Accepted planning baseline; estimates follow Phase 0B evidence

The UI is capability-driven. A control is hidden—not merely disabled—until its
phase, backend/node capability and client profile are all qualified. Intercom/
radio remains the urgent path in every Phase 1 slice.

| Capability | 1A.1 Monitor and identify | 1A.2 Operate and intervene | 1A.3 Recover and rehearse | 1B text collaboration | 1C rich collaboration |
| --- | --- | --- | --- | --- | --- |
| Live audio, meters, RF/battery, replay | yes | yes | hardened | yes | yes |
| A1/A2 views and shared identity | core | expanded | dress-qualified | yes | yes |
| People/roles/assets/performance overlay | core | complex plans | import/restore | yes | yes |
| Guided mic check | resumable core | cue-aware | rehearsal-qualified | yes | yes |
| Single prepared-spare promotion | yes | yes | recovery-qualified | yes | yes |
| Cue authority/occurrences | context only or off | QLab/manual automaton | failure-qualified | yes | yes |
| Multi-role/complex physical swaps | hidden | yes | recovery-qualified | yes | yes |
| Tasks/incidents | foreground queue only | lifecycle + receipts | handoff-qualified | system messages | attachments |
| Urgent notification | intercom/radio only | intercom + foreground queue | same | bounded advisory pages | optional media |
| Chat/conversations/pages | hidden | hidden | hidden | text/pages | rich media |
| Managed headshot/placement images | placeholder/text | placeholder/text | sandboxed asset pipeline | same | same |
| Message attachments/voice/dictation | hidden | hidden | hidden | hidden | profile-gated |
| Ledger import/head reconciliation | minimum live path | hardened | qualified | qualified | qualified |
| Backup/update/spare restore | manual fixture | staging only | qualified | qualified | qualified |
| Supervised dress rehearsal | no | no | exit gate | repeat combined gate | repeat combined gate |

## 1A slices

### 1A.1 — monitor and identify

Implement monitoring, safe output/listen control, receiver state, explicit
performer/role/mic/path identity, guided mic check and one prepared-spare
promotion, plus the minimum ledger import/head comparison needed to reconcile
offline identity mutation. Cue-derived automation, complex swaps and
collaboration are off.

### 1A.2 — operate and intervene

Add the cue handover automaton, intervention plans, complex cast/physical swap
state machines, structured tasks/incidents and foreground receipts. There are no
product pages or chat; a production cannot enter this slice without working
intercom/radio and a rehearsed acknowledgement phrase.

### 1A.3 — recover and rehearse

Harden pruning, backup barriers, migration/restore/import, managed image assets, appliance
hardening, printable pack and the full two-operator failure rehearsal. Only this
slice may seek the Phase 1A exit decision. Each slice receives a fresh estimate
after Phase 0B; the former combined 12–16 week estimate is withdrawn.

## View guardrails

The A2 card always shows one primary next exception plus badges/counts for every
other show-critical category (audio loss, RF, battery, identity, cue, client and
system). Selecting a badge reveals its queue; prioritization can reorder but
never hide an independent critical fault. The A1 surface limits intervention
detail by default and shows mix consequence, confidence, owner and receipt.
