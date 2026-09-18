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

## Compatibility lifecycle

Published support identifies exact OS, driver, audio device, browser, network,
receiver, firmware, schema, and node/backend pairs. Each profile has an owner,
last-tested date, deprecation notice period, and security-support window.
Unobtainable hardware remains unverified rather than receiving a waived gate.

