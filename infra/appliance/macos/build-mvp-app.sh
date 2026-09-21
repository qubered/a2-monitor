#!/bin/sh
set -eu

script_dir="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
repo_root="$(CDPATH= cd -- "$script_dir/../../.." && pwd)"
output_dir="${1:-$repo_root/build/macos-mvp}"
app="$output_dir/A2 Monitor.app"
archive="$output_dir/A2-Monitor-macos-arm64.zip"
node_bin="${A2_NODE_BIN:-$(command -v node)}"

if [ "$(uname -s)" != "Darwin" ] || [ "$(uname -m)" != "arm64" ]; then
  echo "The MVP app builder currently requires Apple-silicon macOS." >&2
  exit 1
fi

node_major="$($node_bin -p 'Number(process.versions.node.split(".")[0])')"
if [ "$node_major" -lt 24 ]; then
  echo "Set A2_NODE_BIN to a portable Node.js 24+ arm64 executable." >&2
  exit 1
fi

case "$output_dir" in
  "$repo_root"/*) ;;
  *) echo "Output directory must be inside the repository." >&2; exit 1 ;;
esac

rm -rf "$app" "$archive"
mkdir -p "$output_dir"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources/bin" "$app/Contents/Resources/app"
mkdir -p "$app/Contents/Resources/app/apps/live" \
  "$app/Contents/Resources/app/apps/manager" \
  "$app/Contents/Resources/app/packages/protocol" \
  "$app/Contents/Resources/app/services/backend" \
  "$app/Contents/Resources/app/services/listen-gateway"

cd "$repo_root"
npm run build --workspace @a2-monitor/backend
npm run build --workspace @a2-monitor/listen-gateway
npm run build --workspace @a2-monitor/live
npm run build --workspace @a2-monitor/manager
cargo build --locked --release --bin a2-device-capture

runtime_root="$(mktemp -d)"
trap 'rm -rf "$runtime_root"' EXIT INT TERM
mkdir -p "$runtime_root/apps/live" "$runtime_root/apps/manager" \
  "$runtime_root/packages/protocol" "$runtime_root/packages/ui" \
  "$runtime_root/services/backend" "$runtime_root/services/listen-gateway"
cp package.json package-lock.json "$runtime_root/"
for package in apps/live apps/manager packages/protocol packages/ui services/backend services/listen-gateway; do
  cp "$package/package.json" "$runtime_root/$package/package.json"
done
(cd "$runtime_root" && npm ci --omit=dev --ignore-scripts)

cp -R "$runtime_root/node_modules" "$app/Contents/Resources/app/node_modules"
rm "$app/Contents/Resources/app/node_modules/@a2-monitor/ui"
cp -R services/backend/dist "$app/Contents/Resources/app/services/backend/dist"
cp services/backend/package.json "$app/Contents/Resources/app/services/backend/package.json"
cp -R "$runtime_root/services/backend/node_modules" \
  "$app/Contents/Resources/app/services/backend/node_modules"
cp -R services/listen-gateway/dist "$app/Contents/Resources/app/services/listen-gateway/dist"
cp services/listen-gateway/package.json "$app/Contents/Resources/app/services/listen-gateway/package.json"
cp -R apps/live/dist "$app/Contents/Resources/app/apps/live/dist"
cp apps/live/package.json "$app/Contents/Resources/app/apps/live/package.json"
cp -R apps/manager/dist "$app/Contents/Resources/app/apps/manager/dist"
cp apps/manager/package.json "$app/Contents/Resources/app/apps/manager/package.json"
cp -R packages/protocol/schema packages/protocol/validation "$app/Contents/Resources/app/packages/protocol/"
cp packages/protocol/package.json "$app/Contents/Resources/app/packages/protocol/package.json"
cp -R "$runtime_root/packages/protocol/node_modules" \
  "$app/Contents/Resources/app/packages/protocol/node_modules"

cp target/release/a2-device-capture "$app/Contents/Resources/bin/a2-device-capture"
cp "$node_bin" "$app/Contents/Resources/bin/node"
cp infra/appliance/macos/mvp-app/launcher.mjs "$app/Contents/Resources/launcher.mjs"
cp infra/appliance/macos/mvp-app/A2-Monitor "$app/Contents/MacOS/A2 Monitor"
chmod 755 "$app/Contents/MacOS/A2 Monitor" "$app/Contents/Resources/bin/"*

cp infra/appliance/macos/mvp-app/Info.plist "$app/Contents/Info.plist"

plutil -lint "$app/Contents/Info.plist"
codesign --force --deep --sign - "$app"
ditto -c -k --sequesterRsrc --keepParent "$app" "$archive"

echo "Built: $app"
echo "Transfer: $archive"
