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
installer described by ADR 0018. The LAN option exposes ADR 0021's unauthenticated
raw PCM transport and is suitable only for a trusted local network. It must not
be port-forwarded or exposed to the internet.
