# Portable application-slot staging

This directory contains the platform-neutral Phase 0T layout smoke generator.
It copies already-built inputs into one inactive immutable version slot. It does
not build software, access the network, install a package, sign an artifact, or
change `current`, `previous`, or `pending` activation state.

Stage a slot with every runtime input named explicitly:

```sh
node infra/appliance/common/stage-application-slot.mjs stage \
  --output-root "$OUTPUT_ROOT" \
  --build-id "$BUILD_ID" \
  --platform macos \
  --arch aarch64 \
  --audio-node target/release/a2-synthetic-capture \
  --supervisor target/release/a2-supervisor-smoke \
  --backend-dist services/backend/dist \
  --backend-dependencies "$PREPARED_PRODUCTION_NODE_MODULES" \
  --protocol-package packages/protocol \
  --manager-dist apps/manager/dist \
  --live-dist apps/live/dist \
  --node-runtime "$PINNED_NODE_BINARY" \
  --node-license "$PINNED_NODE_LICENSE" \
  --process-contract infra/appliance/common/process-boundaries.v0.json \
  --build-identity docs/quality/build-identity.json \
  --release-metadata "$RELEASE_METADATA" \
  --cargo-lock Cargo.lock \
  --npm-lock package-lock.json \
  --cargo-inventory docs/quality/cargo-dependency-inventory.json \
  --node-inventory docs/quality/node-dependency-inventory.json
```

`--backend-dependencies` points directly at a prepared production-only
`node_modules` tree. Preparation is a separate, explicit release step. The
stager never invokes npm and rejects symlinks, including npm workspace links.
The tree must contain Fastify, Ajv, and Ajv Formats. The protocol workspace
package is supplied separately because its package metadata, strict Ajv runtime,
and JSON schemas are runtime dependencies; the stager copies only
`package.json`, `validation`, and `schema`.
The three executable inputs must match the declared target: a Mach-O containing
the requested CPU on macOS, or a PE image with the requested machine type on
Windows. Renaming a binary from another platform is rejected.
The Node licence is copied beside the slot payload. Lockfiles, generated
dependency inventories, and the generated build identity are hashed as explicit
inputs rather than copied as runtime files.

The closed process-boundary contract is validated before staging and copied as
`config/process-boundaries.v0.json`. It distinguishes the three runnable
scaffolds from policy-only and planned processes/threads, keeps every current OS
privilege claim unverified, assigns target lifecycle owners, and maps each
packaged application entrypoint exactly once. A scaffold contract is not a
deployable launch or confinement profile.

Validate the source contract and its adversarial cases with:

```sh
node infra/appliance/common/validate-process-boundaries.mjs
node --test infra/appliance/common/validate-process-boundaries.test.mjs
```

`--release-metadata` is a closed JSON input. It records values that cannot be
inferred safely from filenames:

```json
{
  "schemaVersion": 1,
  "buildProfile": "release",
  "targetTriple": "aarch64-apple-darwin",
  "protocolVersion": "v0",
  "toolchains": {
    "node": "24.21.0",
    "npm": "11.6.2",
    "rustc": "1.98.1",
    "cargo": "1.98.1"
  }
}
```

The command creates only `OUTPUT_ROOT/slots/BUILD_ID` and refuses to overwrite
an existing slot. Its fixed layout is:

```text
slots/BUILD_ID/
├── bin/{a2-synthetic-capture,a2-supervisor-smoke}[.exe]
├── runtime/node[.exe]
├── backend/{package.json,dist/}
├── backend/node_modules/
│   └── @rvlt/pulse-protocol/{package.json,validation/,schema/}
├── config/process-boundaries.v0.json
├── web/{manager,live}/
├── licenses/node/LICENSE
└── slot-manifest.json
```

The closed manifest records its unsigned-smoke artifact kind; application,
slot, build, source and protocol identity; platform/architecture/target/build
profile; declared exact toolchain versions; lock and dependency-inventory
digests; entrypoints;
frontend roots; and every payload file with its role, mode, executable bit, byte
size, and SHA-256. Paths use `/` and byte-order sorting. Non-NFC names, Windows
reserved or invalid names, trailing dots/spaces, overlong paths, and
case-insensitive collisions are rejected. Files and directories receive
deterministic read-only permissions and a fixed 2000-01-01 timestamp where the
host filesystem supports those operations.

The small generated `backend/package.json` fixes Node's module mode to ESM; it
does not replace the dependency input or carry release/build provenance.

Verify a staged tree without changing it:

```sh
node infra/appliance/common/stage-application-slot.mjs verify \
  --slot "$OUTPUT_ROOT/slots/$BUILD_ID"
```

Verification rejects malformed/unknown manifest fields, missing or extra files,
symlinks, unsafe paths, size changes, hash changes, and a process contract whose
content is invalid even when its manifest size/hash are self-consistent. This is layout evidence,
not an installer, signature, update, activation, rollback, or support claim.
The manifest binds the declared versions and inventory inputs but does not infer
their truth from arbitrary binary contents or prove an npm lockfile closure.
Named-host runtime evidence must query the staged tools and exercise the staged
application separately.
