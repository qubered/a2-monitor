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
  CLAUDE.md
  CONTRIBUTING.md
  SECURITY.md
  docs/README.md
  packages/protocol/specification.md
  packages/protocol/model/aggregate-transitions.v0.json
)

for path in "${required_files[@]}"; do
  if [[ ! -s "$path" ]]; then
    echo "Missing or empty required file: $path" >&2
    exit 1
  fi
done

while IFS= read -r path; do
  [[ -f "$path" ]] || continue
  size="$(wc -c < "$path" | tr -d ' ')"
  if (( size > 10485760 )); then
    echo "Tracked file exceeds 10 MiB; use an approved artifact store or Git LFS: $path" >&2
    exit 1
  fi
done < <(git ls-files --cached --others --exclude-standard)

if command -v ruby >/dev/null 2>&1; then
  RUBYOPT="-EUTF-8" ruby scripts/check-markdown-links.rb
  while IFS= read -r path; do
    ruby -rjson -e 'JSON.parse(File.read(ARGV.fetch(0)))' "$path"
  done < <(find packages -type f -name '*.json' -print | sort)
else
  echo "Ruby is required for local Markdown and JSON validation." >&2
  exit 1
fi

node --test \
  infra/appliance/common/stage-application-slot.test.mjs \
  infra/appliance/common/validate-process-boundaries.test.mjs \
  scripts/generate-node-dependency-inventory.test.mjs \
  scripts/generate-cargo-dependency-inventory.test.mjs \
  scripts/generate-build-identity.test.mjs \
  tools/evidence/artifact-loader.test.mjs \
  tools/evidence/evidence-verifier.test.mjs \
  tools/evidence/openssl-vector.test.mjs \
  tools/evidence/synthetic-capture-extractor.test.mjs \
  tools/evidence/strict-json.test.mjs
node scripts/generate-node-dependency-inventory.mjs --check
node infra/appliance/common/validate-process-boundaries.mjs
node scripts/generate-cargo-dependency-inventory.mjs --check
node packages/protocol/scripts/generate-http-contracts.mjs --check
node scripts/generate-build-identity.mjs --check

echo "Repository checks passed."
