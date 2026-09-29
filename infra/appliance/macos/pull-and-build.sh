#!/bin/sh
# Pulls the latest main and builds Pulse.app from it.
#
# Usage: infra/appliance/macos/pull-and-build.sh [output_dir]
# output_dir is forwarded to build-mvp-app.sh (defaults to build/macos-mvp).
set -eu

script_dir="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
repo_root="$(CDPATH= cd -- "$script_dir/../../.." && pwd)"
cd "$repo_root"

if [ "$(uname -s)" != "Darwin" ] || [ "$(uname -m)" != "arm64" ]; then
  echo "The MVP app builder currently requires Apple-silicon macOS." >&2
  exit 1
fi

branch="$(git rev-parse --abbrev-ref HEAD)"
if [ "$branch" != "main" ]; then
  echo "Currently on branch '$branch'; check out main before running this." >&2
  exit 1
fi

# Only look at tracked files: untracked files (scratch dirs, editor state) never
# conflict with a fast-forward merge, but local edits to tracked files might.
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "Working tree has uncommitted changes to tracked files; commit or stash them first:" >&2
  git status --short --untracked-files=no >&2
  exit 1
fi

echo "==> Pulling latest main"
git fetch origin main
git merge --ff-only origin/main

# npm workspace builds run fine on any Node 24+, but the binary bundled into the
# .app must be a self-contained nodejs.org tarball build, not one linked against
# a shared libnode (Homebrew, nvm, volta): those dyld-crash once copied to
# another Mac. See infra/appliance/macos/build-mvp-app.sh.
brew_node="/opt/homebrew/opt/node@24/bin/node"
if [ -x "$brew_node" ]; then
  export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node 24+ is required on PATH for the npm workspace builds (brew install node@24)." >&2
  exit 1
fi

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$node_major" -lt 24 ]; then
  echo "Node 24+ is required on PATH for the npm workspace builds; found $(node --version)." >&2
  exit 1
fi

if [ -z "${A2_NODE_BIN:-}" ]; then
  node_version="$(node --version)"
  node_cache_dir="$HOME/Library/Caches/a2-monitor/node"
  portable_node="$node_cache_dir/node-$node_version-darwin-arm64/bin/node"

  if [ ! -x "$portable_node" ]; then
    echo "==> Downloading portable Node $node_version for the app bundle"
    mkdir -p "$node_cache_dir"
    tarball="node-$node_version-darwin-arm64.tar.gz"
    curl -fsSL -o "$node_cache_dir/$tarball" "https://nodejs.org/dist/$node_version/$tarball"
    tar -xzf "$node_cache_dir/$tarball" -C "$node_cache_dir"
    rm "$node_cache_dir/$tarball"
  fi
  export A2_NODE_BIN="$portable_node"
fi

echo "==> Building Pulse.app"
sh "$script_dir/build-mvp-app.sh" "$@"
