# Reference productions

**Status:** Accepted product priority

## First: theatre and musical theatre

The first product, workflow, validation rig, and pilot are designed around a
theatre or musical-theatre production. This is the reference context for domain
language and release decisions, not merely an example skin.

### Primary users

- A2/backstage audio and RF technicians preparing, fitting, checking, swapping,
  and monitoring microphones;
- the A1/FOH engineer coordinating investigation and listening;
- an RF coordinator or systems engineer managing receiver and network health;
  and
- production audio leadership reviewing incidents and repeatability.

### Reference workflow

The representative show must exercise:

- performers, characters, understudies/swings, and role reassignment;
- transmitter asset numbers, primary/spare packs, microphone elements,
  costume/placement, and battery changes;
- rack, receiver chassis/slot/channel, audio input, antenna system, and stage/RF
  zones;
- preshow checkout, fitting, mic check, sound check, house open, performance,
  interval, post-show reconciliation, and handoff;
- scenes/cues, On Stage, Up Next, expected silence, entrances/exits, and quick
  changes;
- emergency pack swap or repatch without moving historical evidence to the
  wrong performer; and
- investigation using synchronized live audio, RF, battery, warnings, notes,
  incident ownership, and replay.

The first acceptance fixture is `theatre-reference/v1`: 32 performers, 40 roles,
48 captured and receiver paths, six prepared spares, eight zones and at least
120 cue definitions, with named crew roles and blinded common faults. These are
qualification fixture values, not universal product limits. Its executable gate
is the [Phase 1 operator evidence contract](../quality/phase1-operator-evidence-contract.md).

See [cast, microphone, image, and cue workflows](cast-mics-cues.md) for the
time-bounded assignment and swap model used by this fixture.

### Theatre-specific safety rules

- Performer, character, transmitter, receiver channel, and audio input remain
  distinct identities.
- Understudy or role reassignment changes current bindings without rewriting
  earlier history.
- A quick-change override must be possible from Live, but it is previewed,
  atomic, auditable, reversible, and visibly unverified until checked.
- Silence alerts arm from cue/on-stage context rather than treating every quiet
  offstage microphone as faulty.
- Battery warnings consider the next entrance, interval, and safe change
  opportunity where scheduling data exists.
- Replay must never obscure a new live critical alert during a performance.

## Second: corporate AV

Corporate AV is the second reference production after the theatre workflow has
passed supervised pilots. It reuses the same source/audio/radio identity model
but validates different operational pressure:

- rooms, sessions, agendas, presenters, panels, and rapid turnovers;
- lecterns, handheld pools, lavaliers, headset microphones, and shared assets;
- technician assignment across rooms;
- presenter changes with incomplete advance information;
- battery and asset reset between sessions;
- room-specific receiver/audio/network health; and
- portable show/session templates for repeat events.

Corporate discovery begins during the theatre beta so the domain model does not
become theatre-only. Corporate-specific UI and release gates follow the first
theatre pilot rather than competing with it in Phase 1.

## Later profiles

Concert/festival and broadcast workflows remain research inputs but do not
drive initial scope. They require separate validation for festival patch and
artist turnover, broadcast contribution and compliance, and their differing
receiver, redundancy, and coordination practices.
