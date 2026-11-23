import {
  defineConfig,
  type PlaywrightTestProject,
  type ReporterDescription,
} from "@playwright/test";
import { runPaths } from "./engine/run-dir";
import { ensureRunId } from "./engine/run-info";
import { selectRun } from "./engine/run-selection";

// One environment and one profile per run (E2E_ENV, E2E_PROFILE — see e2e.config.yaml). A bare
// `playwright test` runs the default profile on staging, so prod is never hit by accident.
const run = selectRun();

// Set before workers start, so ${run.id} and test data titles agree across all of them.
ensureRunId();
const environmentName = run.environment.name;
const loginProject = `${environmentName}:login`;

function tierProjectName(tierName: string): string {
  return `${environmentName}:${tierName}`;
}

// Workers evaluate this file too; report once, from the main process.
const isMainProcess = process.env.TEST_WORKER_INDEX === undefined;
if (isMainProcess && run.skippedTiers.length > 0) {
  console.log(
    `${environmentName} does not allow tier(s) ${run.skippedTiers.join(
      ", "
    )} — skipped`
  );
}

// A tier waits for the tiers it needs and does not start if one of them fails. Retrying one test of
// a gated tier can skip the gate on request (E2E_SKIP_NEEDS=1); the login always runs.
const skipNeeds = process.env.E2E_SKIP_NEEDS === "1";
const tierProjects: PlaywrightTestProject[] = run.tiers.map((tier) => ({
  name: tierProjectName(tier.name),
  testMatch: /yaml\.spec\.ts$/,
  grep: new RegExp(`@tier-${tier.name}(?![\\w-])`),
  workers: tier.workers,
  retries: tier.retries,
  dependencies: [
    loginProject,
    ...(skipNeeds ? [] : tier.needs.map(tierProjectName)),
  ],
  use: { storageState: run.environment.storageStatePath },
}));

// A run with E2E_RUN_DIR (the console) writes into its own folder and streams live events; the
// JSON and JUnit reports stay with the shared paths that CI reads.
const paths = runPaths();
const reporters: ReporterDescription[] = [
  ["list"],
  ["html", { outputFolder: paths.htmlReport, open: "never" }],
];
if (paths.jsonReport !== null) {
  reporters.push(["json", { outputFile: paths.jsonReport }]);
}
if (paths.junitReport !== null) {
  // Bitbucket picks up JUnit reports from **/test-results/**/*.xml on its own.
  reporters.push(["junit", { outputFile: paths.junitReport }]);
}
if (paths.events !== null) {
  reporters.push(["./engine/reporters/live-reporter.ts"]);
}

export default defineConfig({
  testDir: "./engine",
  outputDir: paths.artifacts,
  timeout: 5 * 60_000,
  globalTimeout: run.globalTimeoutMs,
  expect: { timeout: 15_000 },
  // Every YAML test comes from one spec file, so tests must be parallel within it.
  fullyParallel: true,
  workers: run.tiers.reduce((total, tier) => total + tier.workers, 0),
  // A committed `only: true` must not silently narrow a CI run.
  forbidOnly: Boolean(process.env.CI),
  reporter: reporters,
  use: {
    baseURL: run.environment.baseUrl,
    viewport: { width: 1440, height: 900 },
    actionTimeout: 30_000,
    navigationTimeout: 90_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    // One retry: a login has stalled on the app's /oauth/callback redirect, and every test
    // depends on it.
    { name: loginProject, testMatch: /auth\.setup\.ts$/, retries: 1 },
    ...tierProjects,
  ],
});
