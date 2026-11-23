#!/usr/bin/env bash
# Checks for every push and pull request: no browser run, no credentials, nothing deployed.
set -euo pipefail
cd "$(dirname "$0")/.."

pnpm install --frozen-lockfile
pnpm typecheck
# The console's server is a package of its own (NestJS): its packages, then its types.
pnpm --dir console/server install --frozen-lockfile
pnpm --dir console/server typecheck
pnpm format:check
pnpm validate
pnpm unit

# Playwright must be able to build every environment × profile (projects, dependencies).
for environment in staging prod; do
  for profile in smoke post-deploy; do
    echo "--list: $environment × $profile"
    E2E_ENV="$environment" E2E_PROFILE="$profile" pnpm exec playwright test --list > /dev/null
  done
done

# Listing never trips the AI start check (it runs as global setup, not when tests are listed).
CI=1 E2E_ENV=demo pnpm exec playwright test --list > /dev/null

# A console run builds too: its own folder (E2E_RUN_DIR) and the live event reporter.
run_dir="$(mktemp -d)"
E2E_RUN_DIR="$run_dir" E2E_ENV=staging E2E_PROFILE=post-deploy pnpm exec playwright test --list > /dev/null
rm -rf "$run_dir"

for script in ci/*.sh hermes/install.sh; do
  bash -n "$script"
done
echo "All checks passed."
