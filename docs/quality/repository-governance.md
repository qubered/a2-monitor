# Repository and release governance

**Status:** Baseline; hosting-specific identities must be configured before the
first external pilot

## Protected branch policy

When hosted, `main` requires:

- pull requests rather than direct pushes;
- passing repository, unit, contract, security, and component checks;
- no mandatory GitHub approval during the named single-maintainer, pre-pilot
  phase; each pull request records a deliberate self-review;
- independent audio-domain review for capture, clock, DSP, codec, routing, or
  replay support claims before external use;
- independent security/platform review for auth, protocol, network, update,
  secret, import/export, sandbox, or appliance release claims before external
  use;
- resolved review conversations and signed commits/releases under the selected
  organization policy; and
- no administrator bypass except a documented incident with retrospective
  review.

CODEOWNERS identities cannot be invented locally. They are configured with the
actual maintainers when the repository host and team accounts exist.

The required-approval branch rule is restored when a second qualified
maintainer becomes active and no later than the first external pilot. Required
checks, pull-request-only changes and administrator enforcement remain active
during the solo phase. Removing an impossible approval gate does not waive any
machine evidence, hardware qualification, operator trial or release sign-off.

## Accountable role matrix

One person may hold several roles during prototyping, but every release record
names the people filling them. Release signing and deployment approval become
separate people before an external pilot.

| Decision or artifact | Accountable role | Required independent review |
| --- | --- | --- |
| Product scope, supported workflows and risk acceptance | Product owner | Theatre operations owner |
| Capture, clock, DSP, Opus, routing and replay | Audio runtime owner | Evidence authority |
| Auth, PKI, confinement, updates and secrets | Platform/security owner | Release/signing custodian |
| Evidence catalogue, verifier and promotion bundle | Evidence authority | Relevant domain owner |
| Receiver protocol/profile claim | Integration owner | Hardware-lab operator |
| A1/A2 workflow and operator gate | Theatre operations owner | Product owner plus participating operator |
| Package signing and release publication | Release/signing custodian | Deployment approver |

The author of a promotion-affecting verifier or catalogue change cannot be its
sole reviewer. A waiver cannot be signed by the person requesting it.

## Automated gates

The first CI workflow runs the repository check on pull requests and `main`.
Before runnable code is merged, component owners add formatting, linting,
unit/contract tests, dependency and secret scanning, SAST, SBOM/provenance, and
artifact verification. A green documentation-only check is not represented as
a secure product build.

## Architecture-review exit rule

The general architecture-review loop is closed. Five rounds ran against
documents alone and the loop began reviewing its own output; the review
documents are withdrawn and their open findings live in
[open questions](../open-questions.md).

No further broad architecture review is requested. Review moves to
evidence-bearing milestones: the disposable spike, Phase 0A, Phase 0B, each
Phase 1A slice, and release/security readiness. No new architecture document
is written until a measured number exists that it responds to.

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
- The working distribution assumption is proprietary software. Before the
  first ASIO evidence build, the owner must record a proprietary Steinberg SDK
  route and provenance, set `CPAL_ASIO_DIR` to a reviewed local SDK, and prove
  the release build performs no network download. If that route is unavailable,
  ASIO packaging and claims remain blocked; the GPLv3 path is not silently mixed
  into a proprietary artifact.
- JUCE fallback use is separately blocked until its commercial/AGPL path is
  approved.
- WiX release tooling is blocked until its current EULA/maintenance-fee terms
  are approved for the organization and revenue profile; an old unsupported
  major is not used to avoid those terms. A commercial MSI authoring tool or
  reviewed direct Windows Installer implementation is the fallback—the product
  requires MSI semantics, not WiX specifically.
- Release builds run without public-network access from a pinned source cache;
  toolchain, SDK, native library and installer inputs have checksums and SBOM/
  provenance. A convenient build-script download is a release failure.

## Compatibility lifecycle

Published support identifies exact OS, driver, audio device, browser, network,
receiver, firmware, schema, and node/backend pairs. Each profile has an owner,
last-tested date, deprecation notice period, and security-support window.
Unobtainable hardware remains unverified rather than receiving a waived gate.
