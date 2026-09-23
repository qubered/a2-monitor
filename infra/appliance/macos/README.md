# macOS unsigned package smoke wrapper

`build-unsigned-pkg.sh` calls the shared portable slot stager, verifies its
closed manifest, and wraps that root with Apple's `pkgbuild` and `productbuild`.
It writes one explicitly named unsigned flat package to an absolute output
directory, refuses overwrite, and never calls `installer`, signing, notarization
or stapling tools.

The wrapper requires the build identity, closed release metadata, Cargo/npm
locks, generated dependency inventories, Node licence input and closed process-
boundary contract and forwards them unchanged to the portable stager. The
package version must equal the version in the build identity.

`inspect-unsigned-pkg.sh` uses `xar`, `pkgutil --expand-full` and `xmllint` to
reject a signature, verify identifier/version/install location, and prove that
the expected slot manifest is in the payload. It expands the package and runs
the portable verifier over the logical extracted tree. `pkgutil --payload-files`
may expose `._*` archive records used to encode macOS extended metadata; those
records are not extracted as independent files and are not application-slot
manifest entries. This is package-layout evidence,
not installation, activation, LaunchAgent, entitlement or platform-support
evidence.

Run the focused macOS test on a Darwin host:

```sh
bash infra/appliance/macos/test-unsigned-pkg.sh
```

## Double-clickable listening MVP

`build-mvp-app.sh` produces an Apple-silicon `Pulse.app` and a zip suitable
for copying to another Mac. The app bundles its Node runtime, production web
assets, backend, listen gateway and native CoreAudio capture executable. It does
not require Node, npm or Rust on the destination Mac.

```sh
A2_NODE_BIN=/path/to/node-24-arm64 \
  bash infra/appliance/macos/build-mvp-app.sh
open "build/macos-mvp/Pulse.app"
```

Two known traps only show up on the *destination* Mac, never on the machine that
built the app, which is what makes them easy to reintroduce:

- **Non-portable `A2_NODE_BIN`.** It must point at the official self-contained
  Node.js binary from [nodejs.org/dist](https://nodejs.org/dist/) (the
  `node-vX.Y.Z-darwin-arm64.tar.gz` tarball's `bin/node`) — not `command -v node`,
  Homebrew's `node`/`node@24`, or an nvm/volta shim. Those link against a shared
  `libnode` dylib outside the tarball; the app copies only the `node` executable
  into `Contents/Resources/bin/`, so a non-portable binary launches fine on the
  machine that built it (its `@rpath` still resolves there) and then crashes with
  `dyld: Library not loaded: @rpath/libnode.*.dylib` on any other Mac. The build
  script now refuses to proceed if `A2_NODE_BIN` links against anything outside
  `/usr/lib` and `/System/Library` (spot-check yourself with
  `otool -L "$A2_NODE_BIN"`), but always download a fresh official tarball rather
  than pointing at whatever `node` is already on `PATH`.
- **A broken `node_modules/@rvlt/pulse-protocol` symlink.** npm workspace hoisting
  makes that path a relative symlink into `packages/protocol` — and it has to stay
  a symlink: `generated/http-contracts.ts` and `receivers/shure-models.ts` are
  imported at runtime and Node 24 type-strips them on the fly, but Node refuses to
  type-strip anything whose *real* path is under `node_modules`; the symlink's
  target resolves outside it, which is what makes this work at all. Copying the
  bundle via the provided zip (`ditto`/`unzip`/Finder's Compress-and-uncompress all
  preserve it) is safe. Copying the raw `.app` through something that can't
  represent Unix symlinks — an exFAT/FAT32 drive, a Dropbox/Google Drive/OneDrive
  synced folder, some AirDrop paths — silently drops or breaks it, and the app then
  crashes on launch with `ERR_MODULE_NOT_FOUND` for `generated/http-contracts.ts`.
  Always hand off `Pulse-macos-arm64.zip`, not a copied `Pulse.app` folder.

At launch, the app opens an Pulse window: pick an observed 48 kHz input
device and whether the page is available only on the host or on its local
network, then click Start Server. The app opens the local page in the default
browser and lives in the menu bar; its icon and the window's own buttons open
Live or Manager, start or stop the server, open the log, and quit. Closing the
window only hides it — reopen it from the menu bar's "Show Pulse" item.
The last chosen device and network scope are remembered for next launch.
Receiver configuration lives in Manager. Logs are written to
`~/Library/Logs/Pulse/mvp.log`.

Open **Manager** from Live to add/remove show channels and patch them to physical
inputs, multiple Shure receiver units, and optional receiver-channel patches.
The app stores that local MVP showfile at
`~/Library/Application Support/Pulse/showfile.json`; it survives app
restart and is read by every Live client connected to the Mac.

This is an ad-hoc-signed development bundle, not the signed, hardened, notarized
installer described by ADR 0018. Listening uses ADR 0026's WebRTC/Opus worker.
Media is DTLS-SRTP encrypted, but signaling and listening are unauthenticated.
The LAN option is suitable only for a trusted local network. It must not be
port-forwarded or exposed to the internet. The media UDP socket binds the Mac's
LAN address in both modes, so macOS may ask whether `pulse-media-worker` can
accept incoming connections. Allow it for LAN listeners. Building the app
requires `cmake` for libopus.
