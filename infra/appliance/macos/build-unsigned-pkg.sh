#!/bin/bash
set -euo pipefail

usage() {
  echo "usage: $0 --output-dir DIR --build-id ID --version VERSION --audio-node FILE --supervisor FILE --backend-dist DIR --backend-dependencies DIR --protocol-package DIR --manager-dist DIR --live-dist DIR --node-runtime FILE --build-identity FILE --release-metadata FILE --cargo-lock FILE --npm-lock FILE --cargo-inventory FILE --node-inventory FILE --node-license FILE [--arch aarch64|x86_64] [--identifier ID] [--install-location PATH]" >&2
}

script_dir="$(cd "$(dirname "$0")" && pwd)"
repository_root="$(cd "$script_dir/../../.." && pwd)"
stager="$repository_root/infra/appliance/common/stage-application-slot.mjs"
output_dir=""
build_id=""
version=""
arch="aarch64"
identifier="com.a2monitor.appliance"
install_location="/Library/Application Support/A2 Monitor"
audio_node=""
supervisor=""
backend_dist=""
backend_dependencies=""
protocol_package=""
manager_dist=""
live_dist=""
node_runtime=""
build_identity=""
release_metadata=""
cargo_lock=""
npm_lock=""
cargo_inventory=""
node_inventory=""
node_license=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output-dir) output_dir="${2-}"; shift 2 ;;
    --build-id) build_id="${2-}"; shift 2 ;;
    --version) version="${2-}"; shift 2 ;;
    --arch) arch="${2-}"; shift 2 ;;
    --identifier) identifier="${2-}"; shift 2 ;;
    --install-location) install_location="${2-}"; shift 2 ;;
    --audio-node) audio_node="${2-}"; shift 2 ;;
    --supervisor) supervisor="${2-}"; shift 2 ;;
    --backend-dist) backend_dist="${2-}"; shift 2 ;;
    --backend-dependencies) backend_dependencies="${2-}"; shift 2 ;;
    --protocol-package) protocol_package="${2-}"; shift 2 ;;
    --manager-dist) manager_dist="${2-}"; shift 2 ;;
    --live-dist) live_dist="${2-}"; shift 2 ;;
    --node-runtime) node_runtime="${2-}"; shift 2 ;;
    --build-identity) build_identity="${2-}"; shift 2 ;;
    --release-metadata) release_metadata="${2-}"; shift 2 ;;
    --cargo-lock) cargo_lock="${2-}"; shift 2 ;;
    --npm-lock) npm_lock="${2-}"; shift 2 ;;
    --cargo-inventory) cargo_inventory="${2-}"; shift 2 ;;
    --node-inventory) node_inventory="${2-}"; shift 2 ;;
    --node-license) node_license="${2-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage; exit 2 ;;
  esac
done

for required in output_dir build_id version audio_node supervisor backend_dist backend_dependencies protocol_package manager_dist live_dist node_runtime build_identity release_metadata cargo_lock npm_lock cargo_inventory node_inventory node_license; do
  if [[ -z "${!required}" ]]; then
    echo "missing required argument: --${required//_/-}" >&2
    usage
    exit 2
  fi
done

[[ "$(uname -s)" == "Darwin" ]] || { echo "macOS packaging requires Darwin" >&2; exit 1; }
[[ "$output_dir" == /* ]] || { echo "--output-dir must be absolute" >&2; exit 2; }
[[ "$arch" == "aarch64" || "$arch" == "x86_64" ]] || { echo "unsupported macOS architecture: $arch" >&2; exit 2; }
[[ "$identifier" =~ ^[A-Za-z0-9]+([.-][A-Za-z0-9]+)+$ ]] || { echo "invalid package identifier" >&2; exit 2; }
[[ "$version" =~ ^[0-9]+([.][0-9]+){0,2}$ ]] || { echo "version must contain one to three numeric components" >&2; exit 2; }
[[ "$install_location" == /* && "$install_location" != "/" && "$install_location" != *".."* ]] || {
  echo "install location must be an absolute non-root path without '..'" >&2
  exit 2
}

for tool in node pkgbuild productbuild; do
  command -v "$tool" >/dev/null || { echo "required tool is unavailable: $tool" >&2; exit 1; }
done
[[ -f "$stager" ]] || { echo "portable stager is missing: $stager" >&2; exit 1; }
identity_version="$(node -e 'const fs=require("fs"); process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).version)' "$build_identity")"
[[ "$version" == "$identity_version" ]] || { echo "package version does not match build identity version" >&2; exit 2; }

mkdir -p "$output_dir"
output_pkg="$output_dir/a2-monitor-${version}-macos-${arch}-unsigned.pkg"
[[ ! -e "$output_pkg" ]] || { echo "refusing to overwrite package: $output_pkg" >&2; exit 1; }

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/a2-macos-package.XXXXXX")"
cleanup() {
  chmod -R u+w "$work_dir" 2>/dev/null || true
  rm -rf "$work_dir"
}
trap cleanup EXIT
stage_root="$work_dir/root"

node "$stager" stage \
  --output-root "$stage_root" \
  --build-id "$build_id" \
  --platform macos \
  --arch "$arch" \
  --audio-node "$audio_node" \
  --supervisor "$supervisor" \
  --backend-dist "$backend_dist" \
  --backend-dependencies "$backend_dependencies" \
  --protocol-package "$protocol_package" \
  --manager-dist "$manager_dist" \
  --live-dist "$live_dist" \
  --node-runtime "$node_runtime" \
  --build-identity "$build_identity" \
  --release-metadata "$release_metadata" \
  --cargo-lock "$cargo_lock" \
  --npm-lock "$npm_lock" \
  --cargo-inventory "$cargo_inventory" \
  --node-inventory "$node_inventory" \
  --node-license "$node_license"

slot="$stage_root/slots/$build_id"
node "$stager" verify --slot "$slot"

component_pkg="$work_dir/a2-monitor-component.pkg"
built_pkg="$work_dir/a2-monitor-unsigned.pkg"
COPYFILE_DISABLE=1 pkgbuild \
  --root "$stage_root" \
  --identifier "$identifier" \
  --version "$version" \
  --install-location "$install_location" \
  --ownership preserve \
  "$component_pkg" >/dev/null
COPYFILE_DISABLE=1 productbuild --package "$component_pkg" "$built_pkg" >/dev/null

"$script_dir/inspect-unsigned-pkg.sh" \
  --package "$built_pkg" \
  --identifier "$identifier" \
  --version "$version" \
  --install-location "$install_location" \
  --build-id "$build_id"

mv "$built_pkg" "$output_pkg"
echo "$output_pkg"
