#!/usr/bin/env bash
# CI entry point for a test run (E2E_ENV and E2E_PROFILE come from the pipeline step):
# install, wait until the deploy that triggered the run is serving, then run the tests.
set -euo pipefail
cd "$(dirname "$0")/.."

pnpm install --frozen-lockfile
pnpm exec tsx ci/wait-for-deploy.ts

outcome=$(node -p 'require("./reports/ready.json").outcome')
if [ "$outcome" = "superseded" ]; then
  echo "A newer build is already serving; its own run tests it — skipping this one."
  exit 0
fi

# The server QA console follows the run live when the repository has QA_CONSOLE_INGEST_URL and
# QA_CONSOLE_INGEST_TOKEN (ci/ingest.mts; it never fails the run), and the run first waits while
# a run of the console's own uses its environment. Without them nothing changes.
if [ -z "${QA_CONSOLE_INGEST_URL:-}" ] || [ -z "${QA_CONSOLE_INGEST_TOKEN:-}" ]; then
  exec pnpm exec playwright test
fi

export E2E_LIVE=1
rm -rf reports/events.ndjson reports/shots reports/console-stream.json
# Not alongside a run someone started in the console on this environment: the same QA account.
node ci/ingest.mts wait || true
node ci/ingest.mts follow &
follower=$!
status=0
pnpm exec playwright test || status=$?
# The follower sends what is left (at most a minute), then stops.
kill -TERM "$follower" 2>/dev/null || true
wait "$follower" || true
exit "$status"
