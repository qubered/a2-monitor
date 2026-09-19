# Repository and release governance

**Status:** Baseline; hosting-specific identities must be configured before the
first external pilot

## Protected branch policy

When hosted, `main` requires:

- pull requests rather than direct pushes;
- passing repository, unit, contract, security, and component checks;
- at least one independent approval;
- audio-domain approval for capture, clock, DSP, codec, routing, or replay time;
- security/platform approval for auth, protocol, network, update, secret,
  import/export, sandbox, or appliance changes;
- resolved review conversations and signed commits/releases under the selected
  organization policy; and
- no administrator bypass except a documented incident with retrospective
  review.

CODEOWNERS identities cannot be invented locally. They are configured with the
actual maintainers when the repository host and team accounts exist.

## Automated gates

The first CI workflow runs the repository check on pull requests and `main`.
Before runnable code is merged, component owners add formatting, linting,
unit/contract tests, dependency and secret scanning, SAST, SBOM/provenance, and
artifact verification. A green documentation-only check is not represented as
a secure product build.

## Architecture-review exit rule

Round 5 is the final general architecture-loop review if it finds no P0 blocker,
every remaining P1 has an owner and phase gate, and schemas, vectors, transition
catalogues, evidence verifier and repository checks agree. Review then moves to
evidence-bearing milestones: Phase 0A, Phase 0B, each Phase 1A slice and release/
security readiness. Another broad review is not requested by default.

The architecture loop reopens only when scope materially changes, a test
falsifies an architectural assumption, a security incident changes the threat
model, or an ADR changes authority, timing, persistence, confinement or physical
identity. P2 polish and owned, phase-gated P1 work do not hold it open. The
release lead owns closure; security and theatre-operation owners may veto their
domains with a concrete failed gate.

## Severity policy

| Severity | Meaning | Release effect |
| --- | --- | --- |
| SEV-1 | Safety risk, programme-path impact, widespread loss/corruption, credential/key compromise, or active critical exploit | Stop deployment; initiate incident response immediately. |
| SEV-2 | Loss of a core monitoring function with no safe in-product recovery, source-identity corruption, serious auth bypass, or repeatable show failure | Blocks pilot/release until fixed or scope removed. |
| SEV-3 | Degraded function with a documented safe workaround | Triage into the current release decision. |
| SEV-4 | Cosmetic, low-impact, or improvement | Normal backlog. |

Response and remediation time targets, a monitored private security contact,
supported-version policy, and disclosure process must be published before an
external pilot.

## Dependency and licensing policy

- Dependencies are pinned, inventoried, vulnerability-monitored, and reviewed
  for runtime privilege and license compatibility.
- Vendor SDKs, protocol fixtures, codecs, and driver headers require a recorded
  redistribution/license review.
- No public release or external contribution programme begins until the project
  license, contribution terms, and third-party notices are approved.
- Release signing, update signing, and deployment approval are separate roles
  once team size permits.
- Rust and Node toolchains are pinned; Cargo and npm lockfiles are committed.
- The shipped SQLite library is bundled and runtime-verified at 3.51.3 or newer.
- CPAL, `str0m`, Opus, SQLite or audio-driver dependency updates run their named
  hardware/browser/power regression subset before promotion.
- ASIO redistribution and JUCE fallback use are blocked until their licence path
  is recorded against the project's eventual software licence.
- WiX release tooling is blocked until its current EULA/maintenance-fee terms
  are approved; an old unsupported major is not used to avoid those terms.

## Compatibility lifecycle

Published support identifies exact OS, driver, audio device, browser, network,
receiver, firmware, schema, and node/backend pairs. Each profile has an owner,
last-tested date, deprecation notice period, and security-support window.
Unobtainable hardware remains unverified rather than receiving a waived gate.
