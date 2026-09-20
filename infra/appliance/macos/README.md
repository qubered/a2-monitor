# macOS unsigned package smoke wrapper

`build-unsigned-pkg.sh` calls the shared portable slot stager, verifies its
closed manifest, and wraps that root with Apple's `pkgbuild` and `productbuild`.
It writes one explicitly named unsigned flat package to an absolute output
directory, refuses overwrite, and never calls `installer`, signing, notarization
or stapling tools.

The wrapper requires the build identity, closed release metadata, Cargo/npm
locks, generated dependency inventories and Node licence input and forwards
them unchanged to the portable stager. The package version must equal the
version in the build identity.

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
