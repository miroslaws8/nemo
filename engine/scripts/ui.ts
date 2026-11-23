import { spawnSync } from "node:child_process";
import path from "node:path";
import { selectedEnvironmentName } from "../environment";
import { E2E_ROOT } from "../paths";
import { resolveRun, selectedProfileName } from "../run-selection";
import { optionValue } from "./cli-options";

// Playwright's UI mode for one environment: the live test tree with each YAML step, stop, re-run
// of any test or of the failed ones, watch mode and the trace of every run.
//   pnpm ui [--env staging] [--profile post-deploy] [--confirm prod]
// It logs in first: UI mode runs the login setup project only when it is ticked in its filter.

const PLAYWRIGHT_CLI = path.join(
  E2E_ROOT,
  "node_modules",
  "@playwright",
  "test",
  "cli.js"
);

function runPlaywright(args: string[], env: NodeJS.ProcessEnv): number {
  const result = spawnSync(
    process.execPath,
    [PLAYWRIGHT_CLI, "test", ...args],
    { cwd: E2E_ROOT, env, stdio: "inherit" }
  );
  return result.status ?? 1;
}

function main(): void {
  const argv = process.argv.slice(2);
  const environmentName = (
    optionValue(argv, "--env") ?? selectedEnvironmentName()
  ).toLowerCase();
  const profileName = (
    optionValue(argv, "--profile") ?? selectedProfileName()
  ).toLowerCase();
  const run = resolveRun(environmentName, profileName);

  if (
    run.environment.guarded &&
    optionValue(argv, "--confirm") !== environmentName
  ) {
    console.error(
      `${environmentName} is guarded: its runs write real data with the shared QA account. Add --confirm ${environmentName} to go on.`
    );
    process.exitCode = 1;
    return;
  }

  const env = {
    ...process.env,
    E2E_ENV: environmentName,
    E2E_PROFILE: profileName,
  };

  // The line reporter keeps the last full run's HTML report in place.
  console.log(`Logging in to ${environmentName}…`);
  const loginStatus = runPlaywright(
    [`--project=${environmentName}:login`, "--reporter=line"],
    env
  );
  if (loginStatus !== 0) {
    process.exitCode = loginStatus;
    return;
  }

  console.log(
    `UI mode: ${environmentName} × ${profileName} — press Ctrl+C here to close it.`
  );
  process.exitCode = runPlaywright(
    ["--ui", "--ui-host", "127.0.0.1", "--ui-port", "0"],
    env
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
