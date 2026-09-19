#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

git diff --check

if command -v rg >/dev/null 2>&1; then
  trailing_output="$(rg -n '[[:blank:]]+$' --hidden \
    --glob '!.git/**' \
    --glob '!node_modules/**' \
    --glob '!dist/**' \
    --glob '!build/**' \
    --glob '!target/**' \
    . || true)"
else
  trailing_output="$(grep -RInE '[[:blank:]]+$' \
    --exclude-dir=.git \
    --exclude-dir=node_modules \
    --exclude-dir=dist \
    --exclude-dir=build \
    --exclude-dir=target \
    . || true)"
fi

if [[ -n "$trailing_output" ]]; then
  echo "$trailing_output"
  echo "Trailing whitespace is not allowed." >&2
  exit 1
fi

required_files=(
  README.md
  AGENTS.md
  CONTRIBUTING.md
  SECURITY.md
  docs/README.md
  docs/product/vision.md
  docs/architecture/overview.md
  docs/architecture/implementation-structure.md
  docs/architecture/collaboration-contract.md
  docs/decisions/0004-active-performance-command-authority.md
  docs/decisions/0005-cue-authority-and-occurrences.md
  docs/decisions/0006-foreground-live-client-profile.md
  docs/decisions/0007-appliance-resource-isolation.md
  docs/decisions/0008-safe-authority-takeover.md
  docs/decisions/0009-live-control-lease-and-data-channel.md
  docs/decisions/0010-persistence-recovery-and-migrations.md
  docs/decisions/0011-untrusted-media-sandbox.md
  docs/decisions/0012-node-process-confinement.md
  docs/decisions/0013-offline-pki-and-key-lifecycle.md
  docs/decisions/0014-rust-audio-runtime-and-host-boundary.md
  docs/decisions/0015-typescript-fastify-react-application-stack.md
  docs/decisions/0016-shared-memory-and-protobuf-local-ipc.md
  docs/decisions/0017-str0m-webrtc-media-worker.md
  docs/decisions/0018-workspaces-testing-and-native-packaging.md
  docs/research/technology-stack-selection.md
  docs/architecture/performance-lifecycle.md
  docs/architecture/runtime-command-contract.md
  docs/architecture/temporal-identity-and-swap.md
  docs/architecture/cue-and-operator-state-machines.md
  docs/architecture/ledger-reconciliation.md
  docs/product/phase-capability-matrix.md
  docs/quality/phase0-evidence-contract.md
  docs/quality/phase1-operator-evidence-contract.md
  docs/quality/listening-safety.md
  docs/quality/definition-of-done.md
  docs/quality/security-baseline.md
  docs/quality/threat-model.md
  docs/quality/validation-matrix.md
  packages/protocol/specification.md
  packages/protocol/model/aggregate-transitions.v0.json
  tests/catalog/evidence-tests.v0.json
  tests/catalog/operator-tests.v0.json
)

for path in "${required_files[@]}"; do
  if [[ ! -s "$path" ]]; then
    echo "Missing or empty required file: $path" >&2
    exit 1
  fi
done

while IFS= read -r path; do
  [[ -e "$path" ]] || continue
  size="$(wc -c < "$path" | tr -d ' ')"
  if (( size > 10485760 )); then
    echo "Tracked file exceeds 10 MiB; use an approved artifact store or Git LFS: $path" >&2
    exit 1
  fi
done < <(git ls-files --cached --others --exclude-standard)

if command -v ruby >/dev/null 2>&1; then
  ruby scripts/check-markdown-links.rb
  while IFS= read -r path; do
    ruby -rjson -e 'JSON.parse(File.read(ARGV.fetch(0)))' "$path"
  done < <(find packages tests -type f -name '*.json' -print | sort)
else
  echo "Ruby is required for local Markdown and JSON validation." >&2
  exit 1
fi

if command -v npm >/dev/null 2>&1; then
  npm run check:contracts
else
  echo "Node.js/npm is required for schema, signature, and evidence validation." >&2
  exit 1
fi

echo "Repository checks passed."
