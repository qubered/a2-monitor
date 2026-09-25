# ADR 0036: Transmitter type detection and a photo fallback icon

- **Status:** Accepted for the local MVP only
- **Date:** 2026-09-25
- **Owners:** Project team
- **Supersedes:** None. Amends [DESIGN.md](../design/DESIGN.md) §10.1.

## Context

Shure receivers already report a raw transmitter model code (`TX_MODEL`/
`TX_TYPE`, e.g. `AD2`, `ADX1`) over the read-only command-string path
(`services/listen-gateway/src/shure.ts`), surfaced untouched as
`transmitter.type` in live state. Manager separately has an operator-set
`micType` field (lavalier, headset, handheld, boundary, instrument, other)
used for no purpose beyond a label today. Two gaps followed from that:

1. Nothing translated the vendor's model code into a physical form factor, so
   an operator who wanted `micType` to reflect a handheld or a bodypack had to
   set it by hand and keep it in sync as transmitters changed.
2. A channel with no photo showed only an empty dashed frame and "Photo not
   added" text, which DESIGN.md's channel-card section required as an
   absolute rule ("never an illustrated avatar, never stock ... reads as
   incomplete, because it is") — a deliberate refusal of any placeholder
   graphic standing in for a real headshot.

Requested: detect handheld vs. beltpack from receiver telemetry and use it to
fill in `micType` automatically, and show a type-appropriate icon instead of
the blank frame when no photo is set, for a faster at-a-glance read.

## Decision

1. **A model-code classifier, not a new vendor field.** Shure's transmitter
   model codes end in `1` for a bodypack/beltpack and `2` for a handheld
   across every family that reports one (AD/ADX, ULX-D, QLX-D, SLX-D).
   `classifyShureTransmitter` (`packages/protocol/receivers/shure-models.ts`)
   matches that pattern against the existing raw `transmitter.type` string;
   no new telemetry field or schema change was needed on the Shure side.
   Like the rest of the command-string tables it draws from, this is
   `compatible-read-only` and unverified until it passes a hardware
   acceptance test.
2. **The operator's `micType` always wins.** `micType` gains a `beltpack`
   value (showfile and live-state schemas). The backend
   (`services/backend/src/live-model.ts`) computes the value it publishes as
   `showChannel.micType ?? classifyShureTransmitter(telemetryChannel transmitter type)`
   — a detected value only fills the gap while the operator hasn't set one.
   Nothing is written back into the showfile; this is a live-state-only,
   per-response computation, so the operator's own choice in Manager can
   never be silently overwritten by a transmitter swap or a misclassified
   model code.
3. **`micTypeSource` marks how a value was set.** A new optional
   `"operator" | "inferred" | null` field on `LiveStateChannel` says whether
   `micType` came from Manager or from telemetry. The honesty grammar
   (DESIGN.md §9) requires inferred data to read as suspected, not
   confirmed, so Live shows `Handheld`/`Beltpack` for an operator value and
   `Likely handheld`/`Likely beltpack` (dashed glyph) for an inferred one.
   The field is optional rather than required in the schema so the existing
   backward-compatibility fixture (`fixtures/v0/http/previous/live-state.valid.json`)
   still validates against the current schema unchanged.
4. **A transmitter's last known model is retained through a dropout.**
   `applyChannelProperty`'s `TX_MODEL`/`TX_TYPE` handling used to null out
   `transmitter.type` whenever a receiver reports `UNKNOWN`/`UNKN` (no
   transmitter linked). It now keeps the last confirmed value and only
   updates `linkStatus`; a power cycle or a dead battery is not evidence
   that a different transmitter is now on the channel, and clearing the
   type also would have dropped the icon fallback every time a performer's
   pack went quiet between cues.
5. **DESIGN.md's "never an illustrated avatar" rule is narrowed, not
   reversed.** The channel card's empty-photo frame may now show a plain
   handheld or beltpack pictograph (2px stroke, §7 Iconography) in place of
   "Photo not added" when a mic type is known, in both Manager's channel
   list and Live's channel card. This is a device pictograph, not a face or
   a stock photo standing in for one — the rule it amends was about
   impersonating a real headshot, which a mic-type glyph never does — and it
   disappears the moment a real photo is set. See DESIGN.md 2.8.0.

## Consequences

### Positive

- An operator who never touches `micType` still gets a useful, low-confidence
  hint of what kind of transmitter a channel uses, both in the data and in
  the UI.
- An operator's explicit choice is never overwritten by telemetry, satisfying
  the same ownership boundary as every other Manager-owned field.
- The card reads faster before photos are uploaded, without reintroducing an
  illustrated-person placeholder DESIGN.md specifically refused.

### Negative

- The classifier is a heuristic over Shure's naming convention, not a vendor
  field; a transmitter whose model code doesn't match the `1`/`2` pattern
  (third-party, or an unlisted Shure model) classifies as unknown and falls
  back to the plain empty frame.
- `micTypeSource` only exists in live state; Manager's own copy of `micType`
  cannot show "inferred" today because it never receives a detected value
  the operator hasn't already accepted into the showfile. A future Manager
  surface for confirming a detected value is out of scope here.

## Alternatives considered

- **Auto-write the detected value into the showfile.** Rejected: it would
  have the backend editing operator-owned configuration state from
  telemetry, blurring the "Manager owns shows, users, mappings, policy"
  boundary, and would need a real confirm/undo flow to stay honest about
  what the operator actually chose.
- **Amend DESIGN.md to allow a full illustrated-avatar fallback (a drawn
  person).** Rejected: the rule exists so a card never reads as "this
  performer has an approved photo" when it doesn't; a device pictograph
  makes no such claim, but a person-shaped illustration would.

## Replacement gate

Replace the model-code heuristic with a receiver-reported form factor if
Shure ever exposes one directly, and replace the live-state-only inference
with a real Manager confirm/accept flow when there's a design for showing
and resolving inferred configuration values generally.
