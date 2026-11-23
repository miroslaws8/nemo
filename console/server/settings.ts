import path from "node:path";
import { E2E_ROOT } from "../../engine/paths";

// Fixed values of the console. What differs between a developer's machine and the team's server
// (port, data folder, limits) comes from QA_CONSOLE_* settings: console/server/config.ts.

// The web app's Vite dev server (pnpm console:dev) proxies the API from this port.
export const DEV_PORT = 7358;

export const WEB_DIST_DIR = path.join(E2E_ROOT, "console", "web", "dist");
export const PLAYWRIGHT_CLI = path.join(
  E2E_ROOT,
  "node_modules",
  "@playwright",
  "test",
  "cli.js"
);

// A stop first lets the tests clean up (SIGINT); a run still going after this is killed.
export const STOP_GRACE_MS = 180_000;

// Sign-in to a server console (console/server/auth): a session ends 12 hours after sign-in or
// after 2 idle hours; a sign-in must come back from the IdP within 10 minutes.
export const SESSION_MAX_MS = 12 * 60 * 60 * 1000;
export const SESSION_IDLE_MS = 2 * 60 * 60 * 1000;
export const SIGN_IN_TTL_MS = 10 * 60 * 1000;
export const IDP_TIMEOUT_MS = 15_000;

// The users a server image runs branch code as (QA_CONSOLE_RUNNERS=sudo, console/server/runners.ts;
// the Dockerfile makes them and console/runner-sudoers lets the console use them).
export const RUNNER_KINDS = ["self", "sudo"] as const;
export const RUNNER_USER = "qa-runner";
export const GUARDED_RUNNER_USER = "qa-runner-guarded";
export const KILL_PROGRAM = "/usr/bin/kill";
export const ENV_PROGRAM = "/usr/bin/env";
export const RM_PROGRAM = "/bin/rm";

// Agent checks (console/server/agents): the providers of their models — what Hermes calls each
// (--provider), the variable Hermes reads its key from, the console setting holding the key, and
// whether it bills writing to its prompt cache (one that does not, OpenAI, has what Hermes counts
// as written counted as new input) — and the models, with list prices per million tokens for the
// cost estimate (below 272K tokens a request for OpenAI's); the tools Hermes gets (its browser
// needs the terminal); how far one check may go.
export const AGENT_PROVIDERS = {
  anthropic: {
    label: "Anthropic",
    hermes: "anthropic",
    keyVariable: "ANTHROPIC_API_KEY",
    setting: "QA_CONSOLE_ANTHROPIC_API_KEY",
    cacheWrites: true,
  },
  openai: {
    label: "OpenAI",
    hermes: "openai-api",
    keyVariable: "OPENAI_API_KEY",
    setting: "QA_CONSOLE_OPENAI_API_KEY",
    cacheWrites: false,
  },
} as const;
export const AGENT_MODELS = [
  {
    id: "claude-haiku-5-5",
    label: "Claude Haiku 5.5",
    provider: "anthropic",
    usdPerMillion: {
      input: 0.1,
      output: 0.5,
      cacheRead: 0.01,
      cacheWrite: 0.125,
    },
  },
  {
    id: "claude-sonnet-5-5",
    label: "Claude Sonnet 5.5",
    provider: "anthropic",
    usdPerMillion: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  },
  {
    id: "gpt-6-luna",
    label: "GPT-6 Luna",
    provider: "openai",
    usdPerMillion: {
      input: 0.1,
      output: 0.5,
      cacheRead: 0.01,
      cacheWrite: 0.1,
    },
  },
] as const;
// The model a check runs on unless one is picked (New run starts with it, CI's checks run on it),
// where the console has its provider's key; else the first model it has one for.
export const AGENT_DEFAULT_MODEL = "gpt-6-luna";
export const AGENT_TOOLSETS = [
  "browser",
  "terminal",
  "skills",
  "vision",
  "todo",
] as const;
export const AGENT_MAX_TURNS = 60;
export const AGENT_RUN_BUDGET_SECONDS = 900;
export const AGENT_WINDOW_SIZE = "1440,900";
export const AGENT_SKILLS_DIR = "hermes/skills";
export const AGENT_SHARED_CONTRACT = "hermes/qa-shared.md";
// Skills added in a server console (console/server/skills): <data dir>/skills, not in git.
export const CONSOLE_SKILLS_DIR = "skills";
// Or, with QA_CONSOLE_SKILLS_* set, in an S3 bucket (any S3-compatible store) every console shares:
// its objects under <prefix>skills/, mirrored into <data dir>/skills-registry and read from there;
// how often the mirror asks the bucket what changed, and how long one request may take.
export const REGISTRY_FOLDER = "skills/";
export const REGISTRY_MIRROR_DIR = "skills-registry";
export const REGISTRY_SYNC_MS = 60_000;
export const REGISTRY_TIMEOUT_MS = 15_000;

// Tests from git (a server console, console/server/workspaces): the clone fetches at most this
// often, lists this many branches, keeps the packages of this many lockfiles, and gives
// pnpm install this long.
export const GIT_FETCH_INTERVAL_MS = 30_000;
export const BRANCH_LIST_SIZE = 100;
export const DEPS_KEPT = 3;
export const DEPS_INSTALL_TIMEOUT_MS = 10 * 60_000;
// Chromium for a Playwright version other than the image's: installed once per version, the two
// versions used last stay (about 400 MB each).
export const BROWSERS_KEPT = 2;
export const BROWSER_INSTALL_TIMEOUT_MS = 10 * 60_000;

// CI: the repository's pipelines on Bitbucket Cloud (<workspace>/<repository>), read with a
// repository access token (Pipelines: Read and Write) from .env. The token stays on the server.
export const BITBUCKET_API = "https://api.bitbucket.org/2.0";
export const BITBUCKET_REPOSITORY_KEY = "QA_CONSOLE_BITBUCKET_REPOSITORY";
export const BITBUCKET_TOKEN_KEY = "QA_CONSOLE_BITBUCKET_TOKEN";
// The custom pipelines the console shows, newest first.
// `agentChecks`: its steps may queue the agent checks of its environment (after a deploy, or on
// a schedule: ci/ingest.mts agents).
export const CI_PIPELINES = new Map<
  string,
  { label: string; env: string | null; agentChecks: boolean }
>([
  ["e2e-staging", { label: "Staging", env: "staging", agentChecks: true }],
  ["e2e-prod", { label: "Prod", env: "prod", agentChecks: true }],
  [
    "e2e-prod-monitor",
    { label: "Prod monitor", env: "prod", agentChecks: false },
  ],
  ["e2e-sweep", { label: "Sweep", env: null, agentChecks: false }],
  [
    "agent-checks-staging",
    { label: "Agent checks staging", env: "staging", agentChecks: true },
  ],
  [
    "agent-checks-prod",
    { label: "Agent checks prod", env: "prod", agentChecks: true },
  ],
]);
export const CI_LIST_SIZE = 30;
// Bitbucket allows a token about 1,000 requests an hour: the console polls only while a page is
// open, every 20 s while a pipeline goes and every 5 min otherwise, and keeps under this budget.
export const CI_ACTIVE_POLL_MS = 20_000;
export const CI_IDLE_POLL_MS = 300_000;
export const CI_LOG_POLL_MS = 8_000;
export const CI_HOURLY_BUDGET = 900;
// A CI step waits while a run of the console's own uses its environment (ci/ingest.mts wait): it
// asks every 15 s. A waiting claim lasts a minute unless asked again; a granted one 2 minutes,
// until the step's stream opens.
export const CI_CLAIM_POLL_MS = 15_000;
export const CI_CLAIM_WAITING_MS = 60_000;
export const CI_CLAIM_GRANTED_MS = 120_000;
