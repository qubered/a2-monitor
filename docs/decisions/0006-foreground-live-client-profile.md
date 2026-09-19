# ADR 0006: Foreground-only Live client operating profile

- **Status:** Hypothesis; no supporting evidence. See [open questions](../open-questions.md).
- **Date:** 2026-09-18
- **Owners:** Project team
- **Supersedes:** None

## Context

Mobile browsers can suspend hidden pages, release wake locks and change audio
behavior when the device locks or another application uses its media session.
Theatre A2 work also requires both hands, camera use and movement backstage.

## Decision

Version one supports a **dedicated foreground show device**:

- Live remains visible with an acquired screen wake lock where supported;
- the device is powered or has validated full-show battery reserve;
- approved wired/USB listening output and dedicated production Wi-Fi are used;
- Guided Access/MDM single-app mode, mount, belt pouch or body-worn arrangement
  is a supported deployment option, not a software guarantee;
- Live continuously shows foreground, wake-lock, media and output state;
- suspension/lock/app switch declares monitoring and product-page delivery
  interrupted and requires explicit recovery; and
- intercom/radio is the authoritative urgent communication path. Product pages
  are advisory workflow accelerators.

Visual paging is the baseline. A sound may use the same controlled client audio
graph and verified sink at a bounded level, off by default. It is disabled on
profiles that cannot prove routing and monitoring continuity.

Voice recording is Phase 1C and profile-gated. It is unavailable if requesting
microphone permission/acquisition changes output route, latency, gain, echo
processing, audio focus or WebRTC continuity. Camera/image workflows receive
the same lifecycle tests.

A native client ADR is triggered if the product owner makes locked/background
listening or reliable background pages a core promise, or if no foreground
profile passes the show-duration, audio-route and recovery gates.

The normative lifecycle, server-observed heartbeat/media evidence, blind-
interval reconstruction, browser ownership and numeric duration/recovery gates
are in [client and appliance profiles](../quality/client-and-appliance-profiles.md)
and the [Phase 0 evidence contract](../quality/phase0-evidence-contract.md).

## Consequences

### Positive

- The product makes a testable promise aligned with browser capabilities.
- Missed product pages cannot be confused with failure of the urgent path.
- Native work has explicit triggers.

### Negative

- Operators need a dedicated screen-awake device and deployment discipline.
- Version one cannot promise pocketed/locked monitoring or alerts.
- Voice notes may be unavailable on otherwise supported clients.

## Alternatives considered

- **Best-effort background PWA:** rejected because behavior varies and cannot be
  treated as show-reliable.
- **Native client immediately:** deferred until foreground validation or a
  product requirement demonstrates that it is necessary.

## Validation

- full-performance thermal/battery test with wake lock and maximum screen load;
- lock, hide, app-switch, Guided Access, permission reset and recovery;
- camera and microphone acquisition during active WebRTC receive;
- notification tone sink, level, interruption and no-program-path verification;
- darkness, gloves, movement, one-handed use and 10–20 second change drills; and
- explicit missed-page/intercom-fallback rehearsal.
