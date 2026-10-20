#!/usr/bin/env bash
# Run the QA harness (tsc, lint, vitest incl. src/test/qa, build, Playwright
# smoke) against ANOTHER checkout of SentryFi — e.g. a temporary worktree of a
# fix branch — without committing anything to it.
#
#   scripts/qa/run-against.sh /path/to/other/tree [log-dir]
#
# The harness files from THIS checkout are copied over the target tree
# (src/test/qa, e2e/, playwright.config.ts, vitest.config.ts) so the target
# is tested with the same safety net. Only use it on a throwaway tree.
set -uo pipefail
HARNESS="$(cd "$(dirname "$0")/../.." && pwd)"
TARGET="$(cd "${1:?usage: run-against.sh <tree> [log-dir]}" && pwd)"
LOGS="${2:-$TARGET/.qa-logs}"
mkdir -p "$LOGS"
[ "$HARNESS" = "$TARGET" ] || {
  rm -rf "$TARGET/src/test/qa" "$TARGET/e2e"
  cp -r "$HARNESS/src/test/qa" "$TARGET/src/test/qa"
  cp -r "$HARNESS/e2e" "$TARGET/e2e"
  cp "$HARNESS/playwright.config.ts" "$TARGET/playwright.config.ts"
  cp "$HARNESS/vitest.config.ts" "$TARGET/vitest.config.ts"
}
cd "$TARGET"
step() { local name=$1; shift; "$@" > "$LOGS/$name.log" 2>&1; local rc=$?; printf '%-8s rc=%s\n' "$name" "$rc" | tee -a "$LOGS/summary.txt"; }
: > "$LOGS/summary.txt"
step install bash -c 'npm ci && npm i --no-save @playwright/test@1.64.1 @testing-library/dom@^10'
step tsc     npx tsc --noEmit -p tsconfig.app.json
step lint    npm run lint
step test    npx vitest run
step build   npm run build
step e2e     npx playwright test --reporter=list
echo "logs: $LOGS"
