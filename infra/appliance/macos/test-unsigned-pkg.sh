#!/bin/bash
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
repository_root="$(cd "$script_dir/../../.." && pwd)"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/a2-macos-package-test.XXXXXX")"
cleanup() {
  chmod -R u+w "$work_dir" 2>/dev/null || true
  rm -rf "$work_dir"
}
trap cleanup EXIT

mkdir -p \
  "$work_dir/backend-dist" \
  "$work_dir/backend-dependencies/fastify" \
  "$work_dir/backend-dependencies/ajv" \
  "$work_dir/backend-dependencies/ajv-formats" \
  "$work_dir/manager-dist" \
  "$work_dir/live-dist" \
  "$work_dir/output"
write_macho_fixture() {
  node -e 'const fs=require("node:fs"); const b=Buffer.alloc(105); b.writeUInt32LE(0xfeedfacf,0); b.writeUInt32LE(0x0100000c,4); b.writeUInt32LE(2,12); b.writeUInt32LE(1,16); b.writeUInt32LE(72,20); b.writeUInt32LE(0x19,32); b.writeUInt32LE(72,36); b.write("__TEXT",40,"ascii"); b.writeBigUInt64LE(105n,64); b.writeBigUInt64LE(105n,80); b.writeInt32LE(5,88); b.writeInt32LE(5,92); fs.writeFileSync(process.argv[1],b)' "$1"
}
write_macho_fixture "$work_dir/audio-node"
write_macho_fixture "$work_dir/supervisor"
write_macho_fixture "$work_dir/node"
printf 'export {};\n' >"$work_dir/backend-dist/start.js"
printf '{"name":"fastify"}\n' >"$work_dir/backend-dependencies/fastify/package.json"
printf '{"name":"ajv"}\n' >"$work_dir/backend-dependencies/ajv/package.json"
printf '{"name":"ajv-formats"}\n' >"$work_dir/backend-dependencies/ajv-formats/package.json"
printf '<!doctype html>\n' >"$work_dir/manager-dist/index.html"
printf '<!doctype html>\n' >"$work_dir/live-dist/index.html"
printf 'Node.js test licence input\n' >"$work_dir/NODE-LICENSE"
printf '%s\n' '{"schemaVersion":1,"buildProfile":"release","targetTriple":"aarch64-apple-darwin","protocolVersion":"v0","toolchains":{"node":"24.21.0","npm":"10.9.8","rustc":"1.98.1","cargo":"1.98.1"}}' >"$work_dir/release-metadata.json"

build_identity="$repository_root/docs/quality/build-identity.json"
build_id="$(node -e 'const fs=require("fs"); process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).buildId)' "$build_identity")"
package_path="$work_dir/output/a2-monitor-0.0.0-macos-aarch64-unsigned.pkg"
"$script_dir/build-unsigned-pkg.sh" \
  --output-dir "$work_dir/output" \
  --build-id "$build_id" \
  --version 0.0.0 \
  --audio-node "$work_dir/audio-node" \
  --supervisor "$work_dir/supervisor" \
  --backend-dist "$work_dir/backend-dist" \
  --backend-dependencies "$work_dir/backend-dependencies" \
  --protocol-package "$repository_root/packages/protocol" \
  --manager-dist "$work_dir/manager-dist" \
  --live-dist "$work_dir/live-dist" \
  --node-runtime "$work_dir/node" \
  --build-identity "$build_identity" \
  --release-metadata "$work_dir/release-metadata.json" \
  --cargo-lock "$repository_root/Cargo.lock" \
  --npm-lock "$repository_root/package-lock.json" \
  --cargo-inventory "$repository_root/docs/quality/cargo-dependency-inventory.json" \
  --node-inventory "$repository_root/docs/quality/node-dependency-inventory.json" \
  --node-license "$work_dir/NODE-LICENSE" \
  --process-contract "$repository_root/infra/appliance/common/process-boundaries.v0.json" >/dev/null

[[ -f "$package_path" ]] || { echo "expected package was not created" >&2; exit 1; }
"$script_dir/inspect-unsigned-pkg.sh" \
  --package "$package_path" \
  --identifier com.a2monitor.appliance \
  --version 0.0.0 \
  --install-location "/Library/Application Support/A2 Monitor" \
  --build-id "$build_id" >/dev/null

if "$script_dir/inspect-unsigned-pkg.sh" \
  --package "$package_path" \
  --identifier com.example.wrong \
  --version 0.0.0 \
  --install-location "/Library/Application Support/A2 Monitor" \
  --build-id "$build_id" >/dev/null 2>&1; then
  echo "inspection accepted the wrong identifier" >&2
  exit 1
fi

tampered_root="$work_dir/tampered-root"
node "$repository_root/infra/appliance/common/stage-application-slot.mjs" stage \
  --output-root "$tampered_root" \
  --build-id "$build_id" \
  --platform macos \
  --arch aarch64 \
  --audio-node "$work_dir/audio-node" \
  --supervisor "$work_dir/supervisor" \
  --backend-dist "$work_dir/backend-dist" \
  --backend-dependencies "$work_dir/backend-dependencies" \
  --protocol-package "$repository_root/packages/protocol" \
  --manager-dist "$work_dir/manager-dist" \
  --live-dist "$work_dir/live-dist" \
  --node-runtime "$work_dir/node" \
  --build-identity "$build_identity" \
  --release-metadata "$work_dir/release-metadata.json" \
  --cargo-lock "$repository_root/Cargo.lock" \
  --npm-lock "$repository_root/package-lock.json" \
  --cargo-inventory "$repository_root/docs/quality/cargo-dependency-inventory.json" \
  --node-inventory "$repository_root/docs/quality/node-dependency-inventory.json" \
  --node-license "$work_dir/NODE-LICENSE" \
  --process-contract "$repository_root/infra/appliance/common/process-boundaries.v0.json" >/dev/null

mkdir "$work_dir/installer-scripts"
mkdir "$work_dir/scripted-build" "$work_dir/extra-build" "$work_dir/symlink-build"
printf '#!/bin/sh\nexit 0\n' >"$work_dir/installer-scripts/preinstall"
chmod 0755 "$work_dir/installer-scripts/preinstall"
pkgbuild \
  --root "$tampered_root" \
  --scripts "$work_dir/installer-scripts" \
  --identifier com.a2monitor.appliance \
  --version 0.0.0 \
  --install-location "/Library/Application Support/A2 Monitor" \
  --ownership preserve \
  "$work_dir/scripted-build/a2-monitor-component.pkg" >/dev/null
productbuild --package "$work_dir/scripted-build/a2-monitor-component.pkg" "$work_dir/scripted.pkg" >/dev/null
if "$script_dir/inspect-unsigned-pkg.sh" \
  --package "$work_dir/scripted.pkg" \
  --identifier com.a2monitor.appliance \
  --version 0.0.0 \
  --install-location "/Library/Application Support/A2 Monitor" \
  --build-id "$build_id" >/dev/null 2>&1; then
  echo "inspection accepted an installer script" >&2
  exit 1
fi

printf 'unmanifested\n' >"$tampered_root/unmanifested.txt"
pkgbuild \
  --root "$tampered_root" \
  --identifier com.a2monitor.appliance \
  --version 0.0.0 \
  --install-location "/Library/Application Support/A2 Monitor" \
  --ownership preserve \
  "$work_dir/extra-build/a2-monitor-component.pkg" >/dev/null
productbuild --package "$work_dir/extra-build/a2-monitor-component.pkg" "$work_dir/extra.pkg" >/dev/null
if "$script_dir/inspect-unsigned-pkg.sh" \
  --package "$work_dir/extra.pkg" \
  --identifier com.a2monitor.appliance \
  --version 0.0.0 \
  --install-location "/Library/Application Support/A2 Monitor" \
  --build-id "$build_id" >/dev/null 2>&1; then
  echo "inspection accepted an unmanifested payload file" >&2
  exit 1
fi

rm "$tampered_root/unmanifested.txt"
live_root="$tampered_root/slots/$build_id/web/live"
chmod 0755 "$live_root"
ln -s index.html "$live_root/linked.html"
pkgbuild \
  --root "$tampered_root" \
  --identifier com.a2monitor.appliance \
  --version 0.0.0 \
  --install-location "/Library/Application Support/A2 Monitor" \
  --ownership preserve \
  "$work_dir/symlink-build/a2-monitor-component.pkg" >/dev/null
productbuild --package "$work_dir/symlink-build/a2-monitor-component.pkg" "$work_dir/symlink.pkg" >/dev/null
if "$script_dir/inspect-unsigned-pkg.sh" \
  --package "$work_dir/symlink.pkg" \
  --identifier com.a2monitor.appliance \
  --version 0.0.0 \
  --install-location "/Library/Application Support/A2 Monitor" \
  --build-id "$build_id" >/dev/null 2>&1; then
  echo "inspection accepted a payload symbolic link" >&2
  exit 1
fi

if "$script_dir/build-unsigned-pkg.sh" \
  --output-dir "$work_dir/output" \
  --build-id "$build_id" \
  --version 0.0.0 \
  --audio-node "$work_dir/audio-node" \
  --supervisor "$work_dir/supervisor" \
  --backend-dist "$work_dir/backend-dist" \
  --backend-dependencies "$work_dir/backend-dependencies" \
  --protocol-package "$repository_root/packages/protocol" \
  --manager-dist "$work_dir/manager-dist" \
  --live-dist "$work_dir/live-dist" \
  --node-runtime "$work_dir/node" \
  --build-identity "$build_identity" \
  --release-metadata "$work_dir/release-metadata.json" \
  --cargo-lock "$repository_root/Cargo.lock" \
  --npm-lock "$repository_root/package-lock.json" \
  --cargo-inventory "$repository_root/docs/quality/cargo-dependency-inventory.json" \
  --node-inventory "$repository_root/docs/quality/node-dependency-inventory.json" \
  --node-license "$work_dir/NODE-LICENSE" \
  --process-contract "$repository_root/infra/appliance/common/process-boundaries.v0.json" >/dev/null 2>&1; then
  echo "package builder overwrote an existing artifact" >&2
  exit 1
fi

echo "macOS unsigned package smoke test passed"
