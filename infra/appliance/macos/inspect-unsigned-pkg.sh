#!/bin/bash
set -euo pipefail

usage() {
  echo "usage: $0 --package FILE --identifier ID --version VERSION --install-location PATH --build-id ID" >&2
}

package=""
identifier=""
version=""
install_location=""
build_id=""
script_dir="$(cd "$(dirname "$0")" && pwd)"
repository_root="$(cd "$script_dir/../../.." && pwd)"
stager="$repository_root/infra/appliance/common/stage-application-slot.mjs"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --package) package="${2-}"; shift 2 ;;
    --identifier) identifier="${2-}"; shift 2 ;;
    --version) version="${2-}"; shift 2 ;;
    --install-location) install_location="${2-}"; shift 2 ;;
    --build-id) build_id="${2-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage; exit 2 ;;
  esac
done

for required in package identifier version install_location build_id; do
  [[ -n "${!required}" ]] || { echo "missing required argument: --${required//_/-}" >&2; exit 2; }
done
[[ "$(uname -s)" == "Darwin" ]] || { echo "package inspection requires Darwin" >&2; exit 1; }
[[ -f "$package" ]] || { echo "package not found: $package" >&2; exit 1; }
for tool in node pkgutil xar xmllint; do
  command -v "$tool" >/dev/null || { echo "required inspection tool is unavailable: $tool" >&2; exit 1; }
done

archive_entries="$(xar -tf "$package")"
if [[ "$archive_entries" == *$'\nSignature\n'* || "$archive_entries" == Signature || "$archive_entries" == Signature$'\n'* || "$archive_entries" == *$'\n'Signature ]]; then
  echo "package unexpectedly contains a signature" >&2
  exit 1
fi
for required_entry in \
  a2-monitor-component.pkg \
  a2-monitor-component.pkg/Bom \
  a2-monitor-component.pkg/Payload \
  a2-monitor-component.pkg/PackageInfo \
  Distribution; do
  grep -Fxq "$required_entry" <<<"$archive_entries" || {
    echo "package archive is missing required member: $required_entry" >&2
    exit 1
  }
done
unexpected_archive_entries="$(grep -Ev '^(a2-monitor-component\.pkg(/(Bom|Payload|PackageInfo))?|Distribution)$' <<<"$archive_entries" || true)"
[[ -z "$unexpected_archive_entries" ]] || {
  echo "package archive contains unexpected members: $unexpected_archive_entries" >&2
  exit 1
}

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/a2-macos-inspect.XXXXXX")"
cleanup() {
  chmod -R u+w "$work_dir" 2>/dev/null || true
  rm -rf "$work_dir"
}
trap cleanup EXIT
pkgutil --expand-full "$package" "$work_dir/expanded"

assert_exact_children() {
  local directory="$1"
  shift
  local count=0 child name expected allowed
  while IFS= read -r child; do
    [[ -n "$child" ]] || continue
    name="${child##*/}"
    allowed=false
    for expected in "$@"; do
      if [[ "$name" == "$expected" ]]; then allowed=true; break; fi
    done
    $allowed || { echo "unexpected package path: $child" >&2; exit 1; }
    count=$((count + 1))
  done < <(find "$directory" -mindepth 1 -maxdepth 1 -print)
  [[ "$count" -eq "$#" ]] || { echo "package path set is incomplete under: $directory" >&2; exit 1; }
}

component_root="$work_dir/expanded/a2-monitor-component.pkg"
payload_root="$component_root/Payload"
assert_exact_children "$work_dir/expanded" a2-monitor-component.pkg Distribution
assert_exact_children "$component_root" Bom Payload PackageInfo
assert_exact_children "$payload_root" slots
assert_exact_children "$payload_root/slots" "$build_id"
if find "$work_dir/expanded" -type l -print -quit | grep -q .; then
  echo "expanded package contains a symbolic link" >&2
  exit 1
fi

mapfile_supported=false
if type mapfile >/dev/null 2>&1; then mapfile_supported=true; fi
if $mapfile_supported; then
  mapfile -t package_infos < <(find "$work_dir/expanded" -name PackageInfo -type f)
else
  package_infos=()
  while IFS= read -r entry; do package_infos+=("$entry"); done < <(find "$work_dir/expanded" -name PackageInfo -type f)
fi
[[ ${#package_infos[@]} -eq 1 ]] || { echo "expected exactly one component PackageInfo" >&2; exit 1; }
package_info="${package_infos[0]}"

actual_identifier="$(xmllint --xpath 'string(/pkg-info/@identifier)' "$package_info")"
actual_version="$(xmllint --xpath 'string(/pkg-info/@version)' "$package_info")"
actual_location="$(xmllint --xpath 'string(/pkg-info/@install-location)' "$package_info")"
[[ "$actual_identifier" == "$identifier" ]] || { echo "identifier mismatch" >&2; exit 1; }
[[ "$actual_version" == "$version" ]] || { echo "version mismatch" >&2; exit 1; }
[[ "$actual_location" == "$install_location" ]] || { echo "install location mismatch" >&2; exit 1; }
[[ "$(xmllint --xpath 'count(/pkg-info/scripts)' "$package_info")" == "0" ]] || {
  echo "component package unexpectedly contains installer scripts" >&2
  exit 1
}

manifest="$payload_root/slots/$build_id/slot-manifest.json"
[[ -n "$manifest" && -f "$manifest" ]] || { echo "staged slot manifest is absent from payload" >&2; exit 1; }
node "$stager" verify --slot "${manifest%/slot-manifest.json}" >/dev/null

echo "unsigned package inspection passed: $package"
