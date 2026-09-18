#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

git diff --check

if command -v rg >/dev/null 2>&1; then
  trailing_output="$(rg -n '[[:blank:]]+$' --hidden --glob '!.git/**' . || true)"
else
  trailing_output="$(grep -RInE '[[:blank:]]+$' --exclude-dir=.git . || true)"
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
  docs/architecture/collaboration-contract.md
  docs/decisions/0004-active-performance-command-authority.md
  docs/decisions/0005-cue-authority-and-occurrences.md
  docs/decisions/0006-foreground-live-client-profile.md
  docs/decisions/0007-appliance-resource-isolation.md
  docs/quality/definition-of-done.md
  docs/quality/security-baseline.md
  docs/quality/threat-model.md
  docs/quality/validation-matrix.md
  packages/protocol/specification.md
)

for path in "${required_files[@]}"; do
  if [[ ! -s "$path" ]]; then
    echo "Missing or empty required file: $path" >&2
    exit 1
  fi
done

while IFS= read -r path; do
  size="$(wc -c < "$path" | tr -d ' ')"
  if (( size > 10485760 )); then
    echo "Tracked file exceeds 10 MiB; use an approved artifact store or Git LFS: $path" >&2
    exit 1
  fi
done < <(git ls-files --cached --others --exclude-standard)

if command -v ruby >/dev/null 2>&1; then
  ruby scripts/check-markdown-links.rb
else
  echo "Ruby is required for local Markdown link validation." >&2
  exit 1
fi

echo "Repository checks passed."
