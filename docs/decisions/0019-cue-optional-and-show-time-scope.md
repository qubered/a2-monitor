# ADR 0019: Cue tracking is optional, and the product owns show time

- **Status:** Accepted
- **Date:** 2026-09-19
- **Owners:** Product owner
- **Supersedes:** None

## Context

Two assumptions had been carried through the plan without ever being stated as
decisions, and designing the Live surfaces surfaced both.

**Cue context was treated as the spine.** The Live view defaulted to On Stage and
Up Next, silence alerting was armed and disarmed from scene state, and
intervention windows were derived from the next cue. All of that assumes a
production with somebody who will meticulously tag every stage movement into a
cue list and keep it accurate under pressure. That person is rare. Theatre with a
dedicated DSM running QLab has them; corporate AV, houses of worship, festivals
and most touring work do not. A product whose default view depends on that person
is degraded for most of the people who install it, and its alerting is wrong
rather than merely sparse.

**The relationship to the vendor wireless tools was stated as a non-goal and
nothing more.** "Not replacing Wireless Systems Manager" is true of coordination
and firmware, and misleading about what an operator actually does during a show,
which is hop between programs to find out what a receiver is doing.

Neither assumption had an owner or a rationale recorded. Both now do.

## Decision

**Cue tracking is an opt-in layer.** Live defaults to every channel. Filters are
group, zone, rack, wired/wireless, warning, stale, unchecked and unverified. When
a cue source is connected, On Stage, Up Next and quick-change filters appear
alongside those and a show may choose one as its default; without a cue source
they are absent rather than empty. No core function may become unavailable or
untrustworthy because a production does not run a cue list.

**Silence alerting is a per-channel setting.** Each source carries its own
arm/disarm for silence, set at show build and changeable during the show. A
spare, a backup capsule, an announce mic and a talkback tap are all legitimately
quiet for long stretches, and none of that depends on a cue. A channel disarmed
for silence says so on its card rather than reading as healthy. Where a cue
source is connected, cue-aware silence arming may refine this; it never replaces
it.

**The product owns show time.** A2 Monitor is a soft replacement for the vendor
wireless tools, and the boundary is time rather than capability: during a
performance the work happens here, and the channel detail carries every value an
operator would otherwise open Wireless Workbench or Wireless Systems Manager to
read. Frequency coordination, scanning, deployment planning and firmware
management remain non-goals and remain in the vendor tools; they are
before-and-after work done sitting down.

## Consequences

### Positive

- The product is useful to a production on its first night, with no cue list and
  nobody assigned to maintain one.
- Alerting no longer has a silent dependency on data most deployments will not
  have. Silence arming is explicit, per channel, and inspectable.
- "No program hopping during a show" is a testable product claim with a clear
  scope, which the receiver-integration work can be measured against.
- The QLab observer becomes a genuine enhancement rather than a load-bearing
  integration, which lowers the risk of its Phase 1A slice.

### Negative

- Every channel's silence setting must be authored somewhere in Manager, and a
  show with 128 sources needs sensible defaults and bulk editing or this becomes
  setup drudgery. Not yet designed.
- The default 64-channel view needs an ordering that is meaningful without cue
  relevance — channel number, rack, zone or most-recently-in-trouble. Open.
- Committing to show-time parity with the vendor tools raises the bar on the
  receiver integrations: a field those tools show and this one does not is now a
  gap rather than a scope boundary. The per-model capability map has to cover
  display, not only control.
- Cue-aware features must be written twice, once with a cue source and once
  without, and tested both ways.

## Alternatives considered

- **Keep cue context as the default and treat its absence as degraded.**
  Rejected: it inverts who the product serves. The common case became the
  exception.
- **Drop cue support entirely.** Rejected: where a cue list exists it is genuinely
  valuable, and the QLab observer is cheap once it is not load-bearing.
- **Draw the vendor-tool boundary by capability — display versus management.**
  This was the first formulation and it is nearly right, but it answers the wrong
  question. Operators do not hop between programs because of a capability
  boundary; they hop because of *when* they need something. Time is the honest
  line.

## Validation

- A rehearsal with no cue source connected completes monitoring, mic check,
  identity and intervention drills with no feature unavailable and no alert
  arming in an unknown state.
- Per-channel silence settings survive show build, activation, a swap and a
  backend restart, and a disarmed channel is visibly disarmed rather than
  healthy.
- An operator running a representative show does not open Wireless Workbench or
  Wireless Systems Manager between house-open and curtain-down. Any value they
  had to leave for is recorded as an integration gap.
