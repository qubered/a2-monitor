# Operator workflows and show-safety model

**Status:** Proposed against the accepted theatre/musical reference production

The baseline workflow is theatre and musical theatre with an A2/RF operator,
an A1, multiple wireless sources, cue-driven performer movement, and a separate
conventional monitoring path. Corporate AV is the second reference profile.
See [reference productions](reference-productions.md).
Detailed cast, asset, swap, image and cue semantics are defined in
[cast, microphone, image, and cue workflows](cast-mics-cues.md).
The two-operator presentation, task, incident and communication model is defined
in [A1/A2 views and collaboration](a1-a2-views-and-collaboration.md).

## Physical vocabulary

In addition to logical sources, the show model needs:

- asset number, rack, receiver chassis/slot/channel, and audio input;
- transmitter asset, primary/spare relationship, battery type, and last change;
- performer, character/role, understudy/swing, costume/placement, microphone
  element, dressing assignment, and quick-change notes;
- antenna system and named RF/stage zone;
- cue/scene membership, On Stage, Up Next, and expected-silent state; and
- responsible operator and last physically verified time.

## Build and activation

Manager imports or creates inventory, creates sources, binds audio and radio,
defines groups/cues/alerts, and produces an immutable show revision. Activation
compares intended and observed identity:

`source -> upstream audio identity -> device input -> receiver serial/channel -> transmitter`

The activation diff identifies missing devices, channel reorder, changed
sample rate, changed receiver firmware, transmitter swaps, capability loss,
and stale verification. Unsafe differences block activation. An authorized
emergency override requires a reason, creates an audit event, and remains
visibly degraded until verified.

## Preflight and mic check

Each source has explicit check states rather than one ambiguous checkbox:

- physical identity/label checked;
- RF/link checked in the relevant zone;
- captured audio heard;
- transmitter mute and control state checked;
- primary and spare pack checked;
- battery changed/approved for the required show window;
- placement/costume note acknowledged; and
- operator and timestamp recorded.

The guided mode orders work by A2 track/zone, uses large pass/fail/recheck
controls, records who verified each dimension, and distinguishes physical fit
from A1-heard captured audio. Absent/costumed/blocked performers stay visible as
exceptions. A swap invalidates only checks whose subject changed.

Preflight also covers audio-device identity, channel count, clock state, node
capacity, storage headroom, certificates, receiver compatibility, network
interfaces, client field kit, UPS, and fallback monitor path.

## Live operation

Live defaults to exceptions and cue context, not an undifferentiated
128-channel wall. Operators can filter by On Stage, Up Next, assigned group,
warning, stale state, and unverified change while retaining a searchable all-
channel view.

Listen controls support momentary and latched audition, previous source,
clear-all, mute, dim, safe maximum level, gain, pan, and keyboard/touch paths.
Source switching changes an established server-side bus and never renegotiates
ordinary media.

Show lock prevents identity, binding, alert-policy, and scene-definition edits.
Live exposes a narrow emergency remap transaction: select/reserve a replacement,
preview the full identity/external-action diff, record physical change in
progress, verify installed RF/audio, request A1 confirmation, and offer an
audited inverse while the old mapping remains historically correct. A fully
preverified spare has a deliberate fast-promotion path. Physical-first changes
can be entered later with their real effective time and uncertainty.

The same transaction model supports a planned or emergency understudy takeover.
The operator explicitly chooses whether fitted microphone assets stay with the
role or with the performer. Cue state and current headshot/labels update at the
same effective boundary without altering earlier history.

## Incidents and handoff

Incident lifecycle is `open`, `investigating`, optional `mitigated`, `resolved`,
`deferred`, or `false-positive`. Seen is a per-user receipt and claim names an
incident coordinator; neither is lifecycle. Resolution records action, evidence
and confidence. Several child-task workers may operate in parallel. Handoff
transfers coordinator/assignees explicitly without erasing history. Observed
facts, derived warnings and suspected causes remain distinct.

Requested work is an explicit task with requester, assignee, due cue/time and
completion evidence. Chat may link to a task or incident but a message, reaction
or read receipt never claims or resolves it. Priority pages require explicit
acknowledgement and remain distinct from ownership.

## Alert behavior

Every rule defines scope, arming condition, threshold, duration, debounce,
hysteresis, cooldown, deduplication key, severity, and required capability.
Rules may be scene/cue/zone aware: silence can be expected offstage, RF can be
evaluated against a zone baseline, and battery runtime can be compared with the
next safe change opportunity. Alert storms collapse into a visible grouped
incident without discarding underlying evidence.

When cue authority is stale, unknown or awaiting resync, cue-derived arming,
expected silence and intervention-window conclusions become unknown/unarmed.
They never continue from the last cue as though it were current.

The UI shows why a rule fired, which measurements were missing, and whether a
cause is observed or inferred. Automatic diagnosis remains out of scope until
labeled rehearsal data establishes false-positive and missed-event rates.

## Replay safety

Replay is visually and audibly distinct from live, shows its offset and epoch,
keeps current critical alerts visible, and offers a one-action return to live.
Changing sources preserves historical time where media exists. Operators can
mark an event without exporting audio; export requires separate permission.

## Rehearsal acceptance scenario

Before a pilot, two operators must build and activate a representative show,
verify every identity, run mic check, swap a transmitter, change a battery,
repatch an input, lose and recover each component/network, investigate and
replay an incident, hand it to another operator, restart the backend, restore a
spare appliance, and finish without attaching current or historical evidence
to the wrong source.

The drill includes a 10–20 second wing pack change, simultaneous actor faults,
cue drift/resync, missed advisory page, locked client, stale receiver telemetry,
a multi-role swing cascade and shift handoff while the A1 continues mixing.
Evidence records wrong-source actions, time-to-audition, verbal clarification,
abandoned work and recovery time.

Manager also generates a versioned printable/offline show pack containing cast
tracks/headshots, pack/receiver/input mapping, spares, placement text/images,
quick changes and a blank emergency change log. Recovery begins from physical
verification against that pack, never by blindly reactivating intended state.
