#!/bin/sh
set -eu

script_dir="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
repo_root="$(CDPATH= cd -- "$script_dir/../../.." && pwd)"
output_dir="${1:-$repo_root/build/macos-mvp}"
app="$output_dir/Pulse.app"
archive="$output_dir/Pulse-macos-arm64.zip"
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

# A Node built against a shared libnode (Homebrew's node@24 formula, some nvm/volta
# installs) passes the version check above and runs fine on this machine because its
# @rpath entries resolve here, but it dyld-crashes the instant the bundled binary is
# copied to a Mac without that same install. Only the self-contained nodejs.org
# tarball build (a single Mach-O with no dependencies outside /usr/lib and
# /System/Library) survives being copied into the app bundle and onto another Mac.
non_system_deps="$(otool -L "$node_bin" | tail -n +2 | awk '{print $1}' | grep -Ev '^(/usr/lib/|/System/Library/)' || true)"
if [ -n "$non_system_deps" ]; then
  echo "A2_NODE_BIN ($node_bin) is not a portable Node binary." >&2
  echo "It links against non-system libraries and will crash with a dyld error" >&2
  echo "('Library not loaded: @rpath/...') once copied to another Mac:" >&2
  echo "$non_system_deps" >&2
  echo "Download the official arm64 tarball from https://nodejs.org/dist/ instead" >&2
  echo "(e.g. node-v24.x.x-darwin-arm64.tar.gz) and set A2_NODE_BIN to its bin/node." >&2
  echo "Do not rely on \`command -v node\`, Homebrew's node, or an nvm/volta shim." >&2
  exit 1
fi

# pulse-media-worker builds upstream libopus from source (opusic-sys).
if ! command -v cmake >/dev/null 2>&1; then
  echo "cmake is required to build libopus for pulse-media-worker (brew install cmake)." >&2
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
npm run build --workspace @rvlt/pulse-backend
npm run build --workspace @rvlt/pulse-listen-gateway
npm run build --workspace @rvlt/pulse-live
npm run build --workspace @rvlt/pulse-manager
cargo build --locked --release --bin pulse-device-capture --bin pulse-media-worker \
  --bin pulse-device-output

runtime_root="$(mktemp -d)"
icon_root="$(mktemp -d)"
trap 'rm -rf "$runtime_root" "$icon_root"' EXIT INT TERM
mkdir -p "$runtime_root/apps/live" "$runtime_root/apps/manager" \
  "$runtime_root/packages/protocol" "$runtime_root/packages/ui" \
  "$runtime_root/services/backend" "$runtime_root/services/listen-gateway"
cp package.json package-lock.json "$runtime_root/"
for package in apps/live apps/manager packages/protocol packages/ui services/backend services/listen-gateway; do
  cp "$package/package.json" "$runtime_root/$package/package.json"
done
(cd "$runtime_root" && npm ci --omit=dev --ignore-scripts)

cp -R "$runtime_root/node_modules" "$app/Contents/Resources/app/node_modules"
rm "$app/Contents/Resources/app/node_modules/@rvlt/pulse-ui"
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
# Bundle exactly the packages/protocol subdirectories that package.json's
# "exports" map can resolve into, instead of a hand-maintained list: a
# hardcoded list silently drifts the moment a new export target lands in a new
# subdirectory (it did for delta/live-state-delta.ts), and the app then
# crashes on the destination Mac with ERR_MODULE_NOT_FOUND for a file that was
# never copied. See infra/appliance/macos/README.md.
protocol_export_dirs="$("$node_bin" -e '
  const fs = require("fs");
  const pkg = JSON.parse(fs.readFileSync("packages/protocol/package.json", "utf8"));
  const dirs = new Set();
  for (const target of Object.values(pkg.exports)) {
    for (const path of typeof target === "string" ? [target] : Object.values(target)) {
      dirs.add(path.replace(/^\.\//, "").split("/")[0]);
    }
  }
  process.stdout.write([...dirs].sort().join(" "));
')"
protocol_dir_paths=""
for dir in $protocol_export_dirs; do
  protocol_dir_paths="$protocol_dir_paths packages/protocol/$dir"
done
cp -R $protocol_dir_paths "$app/Contents/Resources/app/packages/protocol/"
cp packages/protocol/package.json "$app/Contents/Resources/app/packages/protocol/package.json"
cp -R "$runtime_root/packages/protocol/node_modules" \
  "$app/Contents/Resources/app/packages/protocol/node_modules"

mkdir "$icon_root/AppIcon.iconset"
swift infra/appliance/macos/mvp-app/svg-to-png.swift apps/live/public/favicon.svg \
  "16:$icon_root/AppIcon.iconset/icon_16x16.png" \
  "32:$icon_root/AppIcon.iconset/icon_16x16@2x.png" \
  "32:$icon_root/AppIcon.iconset/icon_32x32.png" \
  "64:$icon_root/AppIcon.iconset/icon_32x32@2x.png" \
  "128:$icon_root/AppIcon.iconset/icon_128x128.png" \
  "256:$icon_root/AppIcon.iconset/icon_128x128@2x.png" \
  "256:$icon_root/AppIcon.iconset/icon_256x256.png" \
  "512:$icon_root/AppIcon.iconset/icon_256x256@2x.png" \
  "512:$icon_root/AppIcon.iconset/icon_512x512.png" \
  "1024:$icon_root/AppIcon.iconset/icon_512x512@2x.png"
iconutil -c icns "$icon_root/AppIcon.iconset" -o "$app/Contents/Resources/AppIcon.icns"

swift infra/appliance/macos/mvp-app/svg-to-png.swift infra/appliance/macos/mvp-app/menu-bar-icon.svg \
  "44:$app/Contents/Resources/MenuBarIcon.png"

cp target/release/pulse-device-capture "$app/Contents/Resources/bin/pulse-device-capture"
cp target/release/pulse-media-worker "$app/Contents/Resources/bin/pulse-media-worker"
cp target/release/pulse-device-output "$app/Contents/Resources/bin/pulse-device-output"
cp "$node_bin" "$app/Contents/Resources/bin/node"
cp infra/appliance/macos/mvp-app/launcher.mjs "$app/Contents/Resources/launcher.mjs"
xcrun swiftc \
  -O \
  -target arm64-apple-macos14.0 \
  -framework AppKit \
  infra/appliance/macos/mvp-app/PulseApp.swift \
  -o "$app/Contents/MacOS/Pulse"
chmod 755 "$app/Contents/MacOS/Pulse" "$app/Contents/Resources/bin/"*

cp infra/appliance/macos/mvp-app/Info.plist "$app/Contents/Info.plist"

plutil -lint "$app/Contents/Info.plist"
codesign --force --deep --sign - "$app"
ditto -c -k --sequesterRsrc --keepParent "$app" "$archive"

echo "Built: $app"
echo "Transfer: $archive"
