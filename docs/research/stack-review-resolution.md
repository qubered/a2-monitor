# Stack review resolution

**Status:** Accepted resolution plan for the independent stack reviews

**Research date:** 2026-09-19

**Scope:** Decisions that must be closed before ordinary Phase 0T scaffolding

## Outcome

The reviews do not justify replacing Rust, CPAL, WebRTC/Opus, `str0m`,
TypeScript/Fastify, React/Vite or SQLite. They do justify a hardening slice
before feature scaffolding. The selected components remain behind project-owned
boundaries, while the evidence, process, time, security and distribution
contracts are made implementable.

The disposition is:

| Area | Resolution |
| --- | --- |
| Evidence | Compute predicates from a hashed metrics artifact; verify artifact bytes, elapsed time and named coverage tuples |
| Native process map | Add an explicit canonical sequencer, client gateway, receiver workers and independent backend supervision |
| Windows confinement | Use restricted child tokens, per-worker Job Objects, inherited/duplicated handles and process-bound peer authentication; do not claim service SIDs for logon-task children |
| macOS confinement | Use an `SMAppService` LaunchAgent for the user-session supervisors and signed sandboxed XPC helpers/App Group IPC for untrusted workers where the spike proves audio/network access |
| Browser/API schema | Use `Ajv2020` in strict, non-mutating mode and a validation-first JSON serializer rather than Fastify's Draft-7 serializer for authoritative Draft 2020-12 contracts |
| WebRTC crypto | Disable `str0m` default features; start with Apple Crypto on macOS and Windows Crypto/SChannel on Windows; record and test the exact provider |
| Media time | Derive RTP time from capture epoch/frame position and define epoch, gap and worker-restart behavior explicitly |
| Shared memory | Freeze a fixed little-endian ABI with separate producer/consumer ownership pages and least-write views |
| Backend artifact | Ship a pinned Node runtime plus compiled application JS and an adjacent signed native addon; do not use Node SEA initially |
| Updates | Freeze immutable version slots, an external activation record, data separation and rollback invariants now; defer only the updater vendor/CDN |
| Login | Initial support requires manual login to a dedicated show account; cold-boot and post-login readiness are separate metrics |
| ASIO | Assume proprietary distribution; no GPL ASIO SDK enters a release build. Windows ASIO/DVS support is blocked until the proprietary route is approved |
| Windows installer | MSI/Burn behavior is accepted, but WiX remains conditional on explicit OSMF/EULA approval; a supported commercial MSI authoring product is the fallback |
| Protobuf | Keep the framing and semantic interface codec-neutral; retain Protobuf as the Phase 0T reference only if generation/version-skew evidence beats bounded JSON |

## Evidence system

The old result format carried a runner-authored `status`, so a verifier could
confirm a signature without independently applying a threshold. The replacement
contract:

1. stores each assertion's operator, expected value and unit in the closed
   catalogue;
2. requires a `verifier-metrics` artifact containing measured scalar values;
3. reads and hashes every artifact rather than comparing supplied hash strings;
4. checks elapsed wall time and rejects faults scheduled outside a trial;
5. computes every assertion from the catalogue predicate;
6. returns normalized platform/audio/client coverage from a verified run; and
7. promotes only after every required test and named coverage tuple exists.

The catalogue now includes IPC corruption/confinement, clock and worker recovery,
admission at limit plus one, runtime-contract conformance, storage power cuts,
packaged lifecycle/update and PKI lifecycle. Browser promotion distinguishes
real Chrome/Firefox/Safari devices from Playwright engines.

A metrics artifact is still evidence produced by an instrumented harness, not
an oracle of physical truth. Each hardware test therefore retains its raw
packet, acoustic, integrity or platform artifacts, and the promotion authority
reviews the harness identity and calibration. Future artifact-specific parsers
can recompute more metrics without changing the signed result envelope.

## Platform process and confinement model

### Windows

Microsoft documents that a restricted token can be created from the caller's
own primary token and used with `CreateProcessAsUser` without the usual
`SE_ASSIGNPRIMARYTOKEN_NAME` requirement. Use that mechanism for media, replay,
receiver and browser-gateway workers. Use per-worker Job Objects for resource
accounting, child-process prevention and kill-on-supervisor-close behavior. See
[Restricted Tokens](https://learn.microsoft.com/en-us/windows/win32/secauthz/restricted-tokens)
and [Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects).

Service SIDs are not used for these children because Microsoft adds them to
processes launched by the Service Control Manager, while the audio runtime must
live in the logged-in audio session. The supervisor passes unnamed or random
handle-bound resources directly. A worker receives only its mapping views,
pipe endpoint and required network/file handles. Every pipe connection is bound
to the expected process/token and boot nonce, not merely to the shared show-user
SID.

The spike must prove that restricted media/receiver workers can use their exact
UDP interfaces while the unrestricted audio engine retains ASIO/WASAPI and
MMCSS behavior. AppContainer is a later strengthening option, not an untested
baseline.

### macOS

Apple positions `SMAppService` as the current registration mechanism for
LaunchAgents and requires user approval. The package contains a signed app
bundle with the LaunchAgent definition, and readiness exposes denied/disabled
registration rather than assuming background launch. See
[SMAppService](https://developer.apple.com/documentation/servicemanagement/smappservice)
and Apple's [package/LaunchAgent sample](https://developer.apple.com/documentation/ServiceManagement/updating-your-app-package-installer-to-use-the-new-service-management-api).

Untrusted helpers use signed XPC services where practical. Apple documents that
XPC provides privilege isolation and launchd-managed crash restart; App Groups
support XPC, POSIX shared memory and Unix-domain sockets between sandboxed and
nonsandboxed processes. See [XPC](https://developer.apple.com/documentation/xpc)
and [App Groups](https://developer.apple.com/documentation/BundleResources/Entitlements/com.apple.security.application-groups).

The Phase 0D spike must prove the actual signed entitlements for UDP, App Group
shared memory and replay storage. If a helper cannot be sandboxed without
breaking the required function, the product claim is reduced to process crash
isolation and the exception is documented; a fictional separate-user boundary
is not retained.

## Public schema runtime

Fastify's documented default path uses Ajv for validation and
`fast-json-stringify` for responses. Its examples/default serializer target
Draft 7, while this repository uses Draft 2020-12 and project formats. The
response serializer can also coerce or omit fields, which is unacceptable for
signed or security-sensitive contracts. See Fastify's
[validation and serialization documentation](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/)
and the [`fast-json-stringify` Draft-7 scope](https://github.com/fastify/fast-json-stringify).

The backend therefore installs explicit compilers:

- request validation: `Ajv2020`, `strict: true`, `allErrors: false`, registered
  project formats, `coerceTypes: false`, `useDefaults: false` and
  `removeAdditional: false`;
- authorization/signature verification: performed against the original parsed
  object after schema validation and before any domain projection;
- responses: validate with the same Draft 2020-12 registry, then serialize with
  standard `JSON.stringify`; no schema-driven coercion or silent field removal;
- startup: preload only trusted checked-in schemas and fail if any reference or
  format is unresolved; and
- CI: send every positive/negative golden vector through Ajv, Fastify request
  handling, response validation, generated TypeScript/Rust and canonical JCS.

Fastify must be at least 5.12.2 because its maintainers fixed a 2026 validation
bypass affecting boolean `false` schemas in that release; see
[GHSA-hwr6-493r-vm6h](https://github.com/fastify/fastify/security/advisories/GHSA-hwr6-493r-vm6h).

## WebRTC crypto and media recovery

Current `str0m` exposes selectable AWS-LC, RustCrypto, OpenSSL, Apple Crypto and
Windows Crypto providers; its default is AWS-LC. The choice affects native code,
signing and packaging and must not remain implicit. See the current
[`str0m` crypto documentation](https://docs.rs/str0m/latest/str0m/).

Phase 0B builds with default features disabled:

- macOS: `apple-crypto`;
- Windows: `wincrypto` using the platform DTLS 1.2/SRTP implementation; and
- non-production Linux tests: `rust-crypto-test` only in an explicitly separate
  profile.

AWS-LC is the first fallback if a named browser/OS interoperability or
performance result fails. The provider, feature graph and certificate/SRTP
profile are recorded in every run. A provider change repeats browser, signing,
SBOM and packaging evidence.

A media-worker crash deliberately invalidates its peer state. All affected
clients enter `interrupted`; the backend creates fresh offers; latched listening
is cancelled; source/gain are restored only through the safe reconnect contract.
Capture continues. A single worker is acceptable for Phase 0 only if the
all-client recovery target passes; otherwise sessions are sharded across worker
processes before field beta.

## Hermetic native builds and distribution

CPAL currently downloads the ASIO SDK automatically when `CPAL_ASIO_DIR` is not
set. That is forbidden in release and evidence builds. See CPAL's
[ASIO build instructions](https://github.com/RustAudio/cpal#compiling-for-asio).

Release builds:

- run without public-network access;
- require `CPAL_ASIO_DIR` to point to a controlled, checksummed SDK supplied
  outside the repository under the approved licence;
- pin exact Rust, Node, npm, .NET SDK/WiX, LLVM/Clang, Protobuf compiler and
  native dependency versions;
- allowlist package/build scripts;
- verify official Node runtime checksums and package that exact runtime;
- build and sign the pinned `better-sqlite3` native addon in the release pipeline
  rather than downloading an unrecorded binary during installation; and
- embed lock hashes, tool versions, native-source hashes and the complete SBOM
  into provenance.

Node SEA is not selected initially because native addons may need extracted
temporary files and platform-specific loading policy. A normal pinned runtime,
compiled JS tree and adjacent signed addon are easier to inventory, repair and
code-sign.

## Licensing and installer decision

The repository's initial commercial assumption is proprietary distribution.
Steinberg now offers GPLv3 and proprietary ASIO paths side by side. GPLv3 ASIO
sources are not compatible with that release assumption, so ASIO-enabled
distribution remains blocked until the proprietary terms are reviewed and
accepted. See Steinberg's [ASIO licensing page](https://www.steinberg.net/developers/asiosdk-open/).

MSI/Burn capabilities remain the Windows packaging requirement. WiX v7 is the
reference authoring tool only after explicit acceptance of its OSMF/EULA and
any fee. Current WiX documentation says qualifying organizations above the
stated revenue threshold must participate and v7 requires explicit EULA
acceptance; see [WiX OSMF](https://docs.firegiant.com/wix/osmf/). The fallback
comparison must use a currently supported commercial MSI authoring product.
Inno Setup can remain a development installer experiment, but it is not called
an MSI replacement.

## Update and login profile

Version one has no unattended in-show updater. An administrator installs signed
offline packages only in stopped maintenance state. Application binaries live
in immutable versioned slots, mutable data lives outside those slots, and a
small signed bootstrap reads an ACL-protected activation record. The previous
compatible slot remains until health confirmation and backup verification.
Windows Installer rollback is retained for transaction failure, but product
rollback does not rely on MSI rollback alone because data/schema activation is
a separate state machine. Microsoft documents Windows Installer's generated
rollback script in [Rollback Installation](https://learn.microsoft.com/en-us/windows/win32/msi/rollback-installation).

The initial appliance requires a human to sign into the dedicated show account.
Metrics are split into power-to-login-ready and login-to-audio-ready; the latter
owns the 120-second target. Automatic login is not silently enabled. A later
managed-appliance profile may evaluate controlled autologin together with full-
disk encryption, physical security and credential recovery.

## Review closure matrix

| Review finding | Disposition | Enforced by |
| --- | --- | --- |
| Verifier trusts runner status | Fixed | predicate catalogue, hashed metrics artifact, adversarial tests |
| Promotion omits matrix | Fixed | named `required_coverage` tuples |
| Missing sequencer/gateway | Fixed in architecture | explicit process map and workspace binaries |
| Backend startup owner missing | Fixed in architecture | independent backend supervisor and OS lifecycle table |
| Service SID/LaunchAgent conflict | Replaced | restricted tokens/Job Objects; XPC/App Group spike |
| Clock-to-RTP mapping absent | Fixed in architecture | sample-clock mapping and clock/worker evidence test |
| Shared-memory corruption underdesigned | Fixed in architecture | frozen ABI/ownership pages and adversarial IPC test |
| Worker restart absent | Fixed | dedicated media clock/worker recovery test |
| Browser impairment/tails weak | Fixed | parameterized impairment plus p50/p95/p99/max assertions |
| Opus negotiation not checked | Fixed | SDP/RTP conformance artifact and stereo/packet assertion |
| Admission not tested | Fixed | declared limit plus one test |
| Draft 2020-12 mismatch | Fixed | explicit Ajv2020/non-mutating compiler contract |
| Update layout deferred | Fixed | version-slot/activation invariants in Phase 0D |
| Exact Node/native artifact unspecified | Fixed | exact pins and packaged runtime/addon form |
| `str0m` crypto implicit | Fixed | platform provider decision and evidence identity |
| ASIO/WiX legal gates late | Moved before dependency/package use | Phase 0D commercial gates |
| Protobuf premature | Qualified | codec-neutral boundary and Phase 0T comparison |
| Ownership generic | Fixed in governance | accountable role matrix before workspace creation |
| ADR 0002 status contradiction | Fixed | architecture accepted; support profile remains evidence-gated |
