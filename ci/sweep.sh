#!/usr/bin/env bash
# Scheduled cleanup: deletes the test user's leftover test data (see sweeper in e2e.config.yaml)
# on each environment. E2E_SWEEP_ENVS narrows the list, e.g. E2E_SWEEP_ENVS=staging.
set -euo pipefail
cd "$(dirname "$0")/.."

pnpm install --frozen-lockfile

for environment in ${E2E_SWEEP_ENVS:-staging prod}; do
  echo "=== $environment ==="
  E2E_ENV="$environment" pnpm exec playwright test --project="$environment:login"
  pnpm sweep --env "$environment" --apply
done
