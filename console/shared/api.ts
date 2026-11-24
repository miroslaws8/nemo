import { z } from "zod";
import { liveTestSchema } from "../../engine/reporters/live-events";
import {
  SKILL_MAX_BYTES,
  SKILL_SAFETIES,
  skillFieldsSchema,
} from "../../engine/skill-schema";

// The console's HTTP contract, shared by the server (console/server) and the web app (console/web).
// The web app checks every answer against these schemas.

export { liveEventSchema } from "../../engine/reporters/live-events";
export {
  SKILL_MAX_BYTES,
  SKILL_NAME_PATTERN,
  SKILL_SAFETIES,
} from "../../engine/skill-schema";

/** Where a skill comes from: the run's commit (hermes/skills), or added in a server console. */
export const SKILL_ORIGINS = ["repo", "console"] as const;

/** Where a console keeps the skills added in it (console/server/skills/skill-stores.ts). */
export const SKILL_STORE_KINDS = [
  "working-tree",
  "console",
  "registry",
] as const;

/** How a console runs (console/server/config.ts): on a developer's machine, or for the team. */
export const CONSOLE_MODES = ["local", "server"] as const;

/** What a person may do in a server console; each role can do what the one before can. */
export const ROLES = ["viewer", "runner", "operator"] as const;

export const RUN_STATUSES = [
  "queued",
  // A server console gets the run's commit and its packages ready.
  "preparing",
  "starting",
  "running",
  "stopping",
  "passed",
  "failed",
  "interrupted",
  "timedout",
  "killed",
  "crashed",
] as const;

/** A run in one of these holds its environment: one run per environment at a time. */
export const ACTIVE_RUN_STATUSES = [
  "preparing",
  "starting",
  "running",
  "stopping",
] as const;

/** Where a console's tests come from: this working tree, or a git commit per run (a server). */
export const TEST_SOURCES = ["working-tree", "git"] as const;

/** The commit a run tests: its branch and sha; both null for the working tree. */
export const runSourceSchema = z.object({
  ref: z.string().nullable(),
  sha: z.string().nullable(),
});

export const RETRY_SCOPES = ["test", "failed", "all"] as const;

const countSchema = z.number().int().min(0);

export const runCountsSchema = z.object({
  total: countSchema,
  passed: countSchema,
  failed: countSchema,
  flaky: countSchema,
  skipped: countSchema,
  interrupted: countSchema,
  running: countSchema,
  queued: countSchema,
});

export const runSelectionSchema = z.object({
  label: z.string(),
  // null: every test of the profile.
  testIds: z.array(z.string()).nullable(),
  grep: z.string().nullable(),
});

/** A CI run that the console follows (ci/ingest.mts sends it): its pipeline in Bitbucket. */
export const ciRunSchema = z.object({
  number: z.number().int(),
  // One per try of the step: a rerun of the step is another run (b<number>-2).
  attempt: z.string(),
  url: z.string(),
});

/** What an agent check spent: tokens as Hermes counted them, dollars as the console estimates. */
export const agentUsageSchema = z.object({
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  cacheReadTokens: z.number().int().min(0),
  cacheWriteTokens: z.number().int().min(0),
  estimatedUsd: z.number().min(0),
});

/** An agent check: Hermes Agent runs one of nemo's skills (hermes/skills) with a model. */
export const agentRunSchema = z.object({
  skill: z.string().min(1),
  model: z.string().min(1),
  // What the skill gets after the environment (e.g. an asset type); "" for nothing.
  arguments: z.string().default(""),
  // Where its skill came from, and the console's version of it (null: the repo's).
  skillOrigin: z.enum(SKILL_ORIGINS).default("repo"),
  skillVersion: z.number().int().positive().nullable().default(null),
  // The CI pipeline that queued it (after a deploy, or on its schedule); null: a person did.
  queuedBy: z
    .object({ number: z.number().int(), label: z.string(), url: z.string() })
    .nullable()
    .default(null),
  // null until the run is over (or when Hermes reported nothing).
  usage: agentUsageSchema.nullable().default(null),
});

/** A test written by AI from a description (pnpm author; engine/author.spec.ts). */
export const authorRunSchema = z.object({
  goal: z.string().min(1),
});

/** reports/runs/<id>/run.json */
export const runRecordSchema = z.object({
  id: z.string().min(1),
  env: z.string().min(1),
  profile: z.string().min(1),
  kind: z.enum(["run", "retry"]),
  parentId: z.string().nullable(),
  selection: runSelectionSchema,
  skipNeeds: z.boolean(),
  status: z.enum(RUN_STATUSES),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  pid: z.number().int().nullable(),
  // `ps -o lstart=` of the runner, so a restarted console re-attaches to the same process only.
  processStart: z.string().nullable(),
  exitCode: z.number().int().nullable(),
  stopRequestedAt: z.string().nullable(),
  summary: runCountsSchema.nullable(),
  // Who started it and who stopped it: an email, null where nobody signs in (or nobody stopped it).
  startedBy: z.string().nullable().default(null),
  stoppedBy: z.string().nullable().default(null),
  // The branch and commit it tests (a server console); null: the working tree.
  ref: z.string().nullable().default(null),
  sha: z.string().nullable().default(null),
  // A CI run the console follows (id b<build number>); null: the console's own run.
  ci: ciRunSchema.nullable().default(null),
  // An operator started it without waiting for a CI run on its environment.
  alongsideCi: z.boolean().default(false),
  // An agent check (Hermes); null: a run of the YAML tests.
  agent: agentRunSchema.nullable().default(null),
  // A test being written from a description; null: not an author run.
  author: authorRunSchema.nullable().default(null),
});

/** GET /api/runs: newest first. */
export const runListSchema = z.array(runRecordSchema);

/** The stream's "removed" event: run folders deleted as old (the newest KEEP_RUNS stay). */
export const removedRunsSchema = z.object({ ids: z.array(z.string()) });

export const environmentInfoSchema = z.object({
  name: z.string(),
  baseUrl: z.string(),
  guarded: z.boolean(),
  // The branch a server console runs its tests from unless told otherwise.
  branch: z.string(),
});

export const tierInfoSchema = z.object({
  name: z.string(),
  description: z.string().nullable(),
  // Tiers that run (in full) before this one, unless a run skips them.
  needs: z.array(z.string()),
  // Creates no data, so a run of only these tiers has nothing to clean up.
  readOnly: z.boolean(),
});

export const profileInfoSchema = z.object({
  name: z.string(),
  tiers: z.array(z.string()),
  description: z.string().nullable(),
});

/** GET /api/config */
/** A model agent checks may use. */
export const agentModelSchema = z.object({
  id: z.string(),
  label: z.string(),
  // Whose model it is (its key's), e.g. Anthropic.
  provider: z.string().default(""),
  // Whether the console offers it (it has its provider's key), and why not.
  available: z.boolean().default(true),
  reason: z.string().nullable().default(null),
});

/** Whether this console runs agent checks (Hermes and a model key), and with which models. */
export const agentsInfoSchema = z.object({
  available: z.boolean(),
  // Why not, when not.
  reason: z.string().nullable(),
  models: z.array(agentModelSchema),
  defaultModel: z.string(),
  // How far one check may go: model turns, and seconds.
  limits: z
    .object({ maxTurns: z.number().int(), budgetSeconds: z.number().int() })
    .default({ maxTurns: 0, budgetSeconds: 0 }),
});

/** Where this console keeps the skills added in it, and whether this console may write there. */
export const skillStoreInfoSchema = z.object({
  kind: z.enum(SKILL_STORE_KINDS),
  // Whether skills may be added and given versions here, and why not.
  editable: z.boolean(),
  reason: z.string().nullable(),
  // Whether a version is promoted to prod (a store with versions), or the branch decides.
  channels: z.boolean(),
});

export const consoleConfigSchema = z.object({
  environments: z.array(environmentInfoSchema),
  tiers: z.array(tierInfoSchema),
  profiles: z.array(profileInfoSchema),
  // What a bare `pnpm exec playwright test` runs.
  defaultEnvironment: z.string(),
  defaultProfile: z.string(),
  testsFrom: z.enum(TEST_SOURCES),
  // A commit's page, with {sha} for its id; null when the console does not know one.
  commitUrl: z.string().nullable(),
  skillStore: skillStoreInfoSchema.default({
    kind: "working-tree",
    editable: true,
    reason: null,
    channels: false,
  }),
  // Writing a skill from a description here (Skills → Add skill → Describe it), or why not.
  skillWriting: z
    .object({ available: z.boolean(), reason: z.string().nullable() })
    .default({ available: false, reason: null }),
  // Writing tests with AI here (New run → Write a test), or why not.
  authoring: z
    .object({ available: z.boolean(), reason: z.string().nullable() })
    .default({ available: false, reason: null }),
  agents: agentsInfoSchema.default({
    available: false,
    reason: null,
    models: [],
    defaultModel: "",
    limits: { maxTurns: 0, budgetSeconds: 0 },
  }),
});

/** What agent checks spent today (UTC) against the console's daily limit, in dollars. */
export const agentSpendSchema = z.object({
  todayUsd: z.number().min(0),
  dailyUsd: z.number().min(0),
});

/** GET /api/agents/skills: the skills of the commit an agent check would run. */
export const agentSkillsSchema = z.object({
  source: runSourceSchema,
  spend: agentSpendSchema,
  skills: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      // Why the console cannot run it (null: it can).
      unavailable: z.string().nullable(),
      origin: z.enum(SKILL_ORIGINS).default("repo"),
      // The console's version of it (null: the repo's).
      version: z.number().int().positive().nullable().default(null),
    })
  ),
});

/** POST /api/agent-runs */
export const startAgentRunRequestSchema = z.strictObject({
  env: z.string().min(1),
  skill: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  // One of the console's models; its default model when left out.
  model: z.string().min(1).optional(),
  // One line for the skill after the environment, e.g. an asset type.
  arguments: z
    .string()
    .max(200)
    .regex(/^[^\p{Cc}]*$/u, "one line, no control characters")
    .optional(),
  ref: z.string().min(1).optional(),
  alongsideCi: z.boolean().optional(),
  confirm: z.string().optional(),
});

/** POST /api/author-runs */
export const startAuthorRunRequestSchema = z.strictObject({
  env: z.string().min(1),
  // What to check, in a person's words.
  goal: z
    .string()
    .trim()
    .min(5)
    .max(500)
    .regex(/^[^\p{Cc}]*$/u, "one paragraph, no control characters"),
});

/** <run dir>/author/result.json, as the author writes it (engine/author.spec.ts). */
export const authorResultSchema = z.object({
  goal: z.string(),
  environment: z.string(),
  outcome: z.enum(["done", "impossible", "incomplete"]),
  summary: z.string(),
  turns: z.array(
    z.object({
      tool: z.string(),
      input: z.unknown(),
      ok: z.boolean(),
      result: z.string(),
    })
  ),
  verification: z
    .object({ verified: z.boolean(), why: z.string() })
    .nullable()
    .default(null),
  draft: z
    .object({
      file: z.string(),
      tier: z.string(),
      submitsForm: z.boolean(),
    })
    .nullable(),
});

/** GET /api/runs/<id>/author: the result (null while it runs) and the draft's YAML. */
export const authorAnswerSchema = z.object({
  result: authorResultSchema.nullable(),
  draft: z.object({ file: z.string(), yaml: z.string() }).nullable(),
});

/** POST /api/runs/<id>/author/save: where the test went, from the repository root. */
export const saveTestAnswerSchema = z.object({ file: z.string() });

/** GET /api/catalog: the tests a run of one environment × profile can select. */
export const catalogTestSchema = liveTestSchema.extend({
  // The --test-list line that selects exactly this test.
  listLine: z.string(),
});

export const catalogSchema = z.object({
  // The commit it was listed from (a server lists the branch asked for).
  source: runSourceSchema,
  tests: z.array(catalogTestSchema),
});

/** GET /api/branches: the branches a server console can run, newest commit first. */
export const branchListSchema = z.array(
  z.object({
    name: z.string(),
    sha: z.string(),
    committedAt: z.string(),
    subject: z.string(),
  })
);

/** GET /api/runs/:id/log?offset: whole lines from `offset` on, and where the next read starts. */
export const logChunkSchema = z.object({
  offset: z.number().int().min(0),
  text: z.string(),
});

/** GET /api/source?file&line: the YAML around one line. */
export const sourceSnippetSchema = z.object({
  file: z.string(),
  line: z.number().int(),
  lines: z.array(z.object({ number: z.number().int(), text: z.string() })),
});

// Skills (console/server/skills): the Hermes skills agent checks follow — the repo's, and on a
// server console the ones added in it.

/** One version of a skill added in the console. */
export const skillVersionSchema = z.object({
  version: z.number().int().positive(),
  by: z.string().nullable(),
  at: z.string(),
  hash: z.string(),
});

/** A skill as the Skills page lists it. */
/** A stored skill's version promoted to prod (POST /api/skills/<name>/promote). */
export const skillPromotionSchema = z.object({
  version: z.number().int().positive(),
  by: z.string().nullable(),
  at: z.string(),
});

export const promoteSkillRequestSchema = z.strictObject({
  version: z.number().int().positive(),
});

export const skillSummarySchema = z.object({
  name: z.string(),
  origin: z.enum(SKILL_ORIGINS),
  // The console's version of it (null: the repo's).
  version: z.number().int().positive().nullable(),
  // From its skill.yaml (null: the branch has none, or a wrong one: see problem).
  title: z.string().nullable(),
  description: z.string(),
  safety: z.enum(SKILL_SAFETIES).nullable(),
  aiCredits: z.boolean(),
  startAt: z.string().nullable(),
  // Why the console cannot run it (null: it can).
  unavailable: z.string().nullable(),
  // A console skill whose name the repo has too, on this branch: the repo's one runs.
  shadowed: z.boolean(),
  // What is wrong with its skill.yaml on this branch (null: nothing).
  problem: z.string().nullable(),
  // The environments CI runs it on after a deploy and on a schedule (agent_checks).
  afterDeploys: z.array(z.string()),
  lastRun: z
    .object({
      id: z.string(),
      status: z.enum(RUN_STATUSES),
      endedAt: z.string().nullable(),
      usd: z.number().nullable(),
    })
    .nullable(),
  // Who added or last replaced it in the console, and when (null: a repo skill).
  updatedBy: z.string().nullable(),
  updatedAt: z.string().nullable(),
  // The version prod runs (promoted); null: none yet, or a repo skill (its branch decides).
  prodVersion: z.number().int().positive().nullable().default(null),
});

/** GET /api/skills */
export const skillListSchema = z.object({
  // The commit the repo's skills come from (ref and sha null: the working tree).
  source: runSourceSchema,
  // Where a skill added here goes: this working copy, this console's store, or the skill store.
  store: z.enum(SKILL_STORE_KINDS),
  skills: z.array(skillSummarySchema),
});

/** What is wrong with a skill.yaml, and where (line null: the file as a whole). */
export const skillProblemSchema = z.object({
  severity: z.enum(["error", "warning"]),
  message: z.string(),
  path: z.array(z.union([z.string(), z.number()])),
  line: z.number().int().nullable(),
  column: z.number().int().nullable(),
});

/** GET /api/skills/<name> */
export const skillDetailSchema = z.object({
  skill: skillSummarySchema,
  // Its skill.yaml and SKILL.md (null: a branch from before skill.yaml, or a wrong one).
  yaml: z.string().nullable(),
  skillMd: z.string().nullable(),
  fields: skillFieldsSchema.nullable(),
  // What a new version says it replaces (POST /api/skills/<name>/versions); null: not here.
  hash: z.string().nullable(),
  versions: z.array(skillVersionSchema),
  // Which version prod runs, who promoted it and when; null: none yet, or a repo skill.
  prod: skillPromotionSchema.nullable().default(null),
  // Whether this console may delete it (POST /api/skills/<name>/delete): one it keeps, a working
  // copy's when git does not keep it.
  deletable: z.boolean().default(false),
});

/** POST /api/skills/<name>/delete */
export const skillDeletedSchema = z.object({ deleted: z.string() });

/** POST /api/skills/check: a skill.yaml checked as it would be added or replace one. */
// A file over SKILL_MAX_BYTES still reaches the check, which says so in words.
const skillYamlSchema = z.string().max(SKILL_MAX_BYTES * 4);

export const skillCheckRequestSchema = z.strictObject({
  name: z.string().max(100),
  yaml: skillYamlSchema,
  replacing: z.boolean().default(false),
});

export const diffLineSchema = z.object({
  kind: z.enum(["same", "added", "removed"]),
  text: z.string(),
});

export const skillCheckSchema = z.object({
  problems: z.array(skillProblemSchema),
  // What Hermes would read, and the skill as read; null while it has errors.
  preview: z
    .object({ skillMd: z.string(), fields: skillFieldsSchema })
    .nullable(),
  // A replacement against the skill.yaml it replaces.
  diff: z.array(diffLineSchema).nullable(),
});

/** POST /api/skills */
/** POST /api/skills/write: what the skill should check, in a person's words. */
export const writeSkillRequestSchema = z.strictObject({
  description: z.string().trim().min(10).max(1000),
});

/** What the model wrote, as the console checked it: open it in the form, fix, add. */
export const skillWrittenSchema = z.object({
  name: z.string(),
  yaml: z.string(),
  problems: z.array(skillProblemSchema),
});

export const addSkillRequestSchema = z.strictObject({
  name: z.string().max(100),
  yaml: skillYamlSchema,
});

/** POST /api/skills/<name>/versions */
export const replaceSkillRequestSchema = z.strictObject({
  yaml: skillYamlSchema,
  // The hash of the skill.yaml it replaces (GET /api/skills/<name>): 409 when it changed since.
  basedOn: z.string().min(1),
});

/** GET /api/skills/templates: what a new skill can start from (hermes/skill-templates). */
export const skillTemplateListSchema = z.object({
  templates: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      about: z.string(),
      fields: skillFieldsSchema,
    })
  ),
});

/** GET /api/skills/example: a skill.yaml to start from, and what each field says. */
export const skillExampleSchema = z.object({
  name: z.string(),
  yaml: z.string(),
  fields: z.array(
    z.object({
      field: z.string(),
      required: z.boolean(),
      description: z.string(),
    })
  ),
});

/** The body of every error answer (its HTTP status says which kind). */
export const apiErrorSchema = z.object({ error: z.string() });

/** Why a sign-in failed: /auth/callback sends the browser to /sign-in?problem=<one of these>. */
export const SIGN_IN_PROBLEMS = [
  "expired",
  "refused",
  "unreachable",
  "impersonated",
  "unverified",
  "not-listed",
] as const;

/** POST /auth/logout */
export const signedOutSchema = z.object({ signedOut: z.literal(true) });

/** GET /api/me: who uses the console. Nobody signs in to a local one: its user is an operator. */
export const meSchema = z.object({
  mode: z.enum(CONSOLE_MODES),
  // null: a local console.
  email: z.string().nullable(),
  role: z.enum(ROLES),
});

// CI: the nemo pipelines on Bitbucket (console/server/sources), as the console shows them.

export const CI_STATUSES = [
  "pending",
  "running",
  "paused",
  "passed",
  "failed",
  "error",
  "stopped",
  "expired",
] as const;

/** A pipeline in one of these may still change, so the console keeps polling it. */
export const ACTIVE_CI_STATUSES = ["pending", "running", "paused"] as const;

export const CI_STEP_STATUSES = [
  "pending",
  "ready",
  "running",
  "passed",
  "failed",
  "error",
  "stopped",
  "not-run",
  "expired",
] as const;

export const ciPipelineSchema = z.object({
  // The build number: the pipeline's id in Bitbucket's pages and the run id of its test data.
  number: z.number().int(),
  pattern: z.string(),
  label: z.string(),
  // The environment it tests (null: it is not a test run, e.g. the sweep).
  env: z.string().nullable(),
  // The environment whose name a rerun asks for (prod), or null.
  guardedEnv: z.string().nullable(),
  branch: z.string().nullable(),
  status: z.enum(CI_STATUSES),
  createdAt: z.string(),
  endedAt: z.string().nullable(),
  creator: z.string().nullable(),
  trigger: z.string(),
  // Not the secured ones.
  variables: z.array(z.object({ key: z.string(), value: z.string() })),
  url: z.string(),
});

/** GET /api/ci and the stream's "ci" event. */
export const ciOverviewSchema = z.object({
  configured: z.boolean(),
  error: z.string().nullable(),
  // Bitbucket answered 429: the console asks again after this.
  pausedUntil: z.string().nullable(),
  checkedAt: z.string().nullable(),
  pipelines: z.array(ciPipelineSchema),
});

export const ciStepSchema = z.object({
  uuid: z.string(),
  name: z.string(),
  status: z.enum(CI_STEP_STATUSES),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
});

export const ciTestCaseSchema = z.object({
  name: z.string(),
  suite: z.string().nullable(),
  status: z.string(),
  reasons: z.array(z.string()),
});

/** A step's JUnit report as Bitbucket keeps it; the failed tests with what went wrong. */
export const ciReportSchema = z.object({
  total: z.number().int(),
  passed: z.number().int(),
  failed: z.number().int(),
  skipped: z.number().int(),
  failedCases: z.array(ciTestCaseSchema),
});

/** GET /api/ci/pipelines/:number */
export const ciDetailSchema = z.object({
  pipeline: ciPipelineSchema,
  steps: z.array(ciStepSchema),
  // Bitbucket has a report once a step is over (and only when its tests ran).
  reports: z.array(
    z.object({ stepUuid: z.string(), report: ciReportSchema.nullable() })
  ),
});

/** GET /api/ci/pipelines/:number/steps/:uuid/log?offset */
export const ciLogSchema = logChunkSchema.extend({
  complete: z.boolean(),
});

export const ciRerunRequestSchema = z.strictObject({
  confirm: z.string().optional(),
});

const confirmSchema = z.string().optional();

export const startRunRequestSchema = z.strictObject({
  env: z.string().min(1),
  profile: z.string().min(1),
  // The branch to test (a server console); its environment's own branch by default.
  ref: z.string().min(1).optional(),
  selection: z
    .strictObject({
      testIds: z.array(z.string().min(1)).min(1).optional(),
      grep: z.string().min(1).optional(),
    })
    .optional(),
  skipNeeds: z.boolean().optional(),
  // Start without waiting for a CI run on the environment (an operator's call: both share its
  // QA account and API limit).
  alongsideCi: z.boolean().optional(),
  confirm: confirmSchema,
});

export const retryRequestSchema = z.strictObject({
  scope: z.enum(RETRY_SCOPES),
  testIds: z.array(z.string().min(1)).min(1).optional(),
  skipNeeds: z.boolean().optional(),
  confirm: confirmSchema,
});

export const stopRequestSchema = z.strictObject({
  force: z.boolean().optional(),
});

export const cleanupRequestSchema = z.strictObject({
  apply: z.boolean(),
  confirm: confirmSchema,
});

// CI runs live (ci/ingest.mts → /api/ingest, with a token): a step opens a stream for its
// pipeline, then sends its events in order; the console says where to go on from.

/** POST /api/ingest/streams */
export const ingestStreamRequestSchema = z.strictObject({
  pipeline: z.number().int().positive(),
  attempt: z.string().min(8).max(100),
  env: z.string().min(1),
  profile: z.string().min(1),
});

/** POST /api/ingest/streams/:id/events: events from seq `from` on (the console validates each). */
export const ingestEventsRequestSchema = z.strictObject({
  from: z.number().int().min(0),
  events: z.array(z.unknown()).max(1000),
});

/** POST /api/ingest/claims: a CI step asks for its environment before its tests start. */
export const ingestClaimRequestSchema = z.strictObject({
  pipeline: z.number().int().positive(),
  env: z.string().min(1),
});

/** POST /api/ingest/agent-checks: a step asks for its environment's agent checks. */
export const ingestAgentChecksRequestSchema = z.strictObject({
  pipeline: z.number().int().positive(),
  env: z.string().min(1),
});

/** The answer: each check queued (its run), or why not. */
export const ingestAgentChecksSchema = z.object({
  checks: z.array(
    z.object({
      skill: z.string(),
      runId: z.string().nullable(),
      problem: z.string().nullable(),
    })
  ),
  // Why none were asked for (the pipeline queues none, or the environment lists none).
  note: z.string().nullable(),
});

/** The answer: go now, or ask again in `retryMs` (`waitingFor` says for what). */
export const ingestClaimSchema = z.object({
  granted: z.boolean(),
  waitingFor: z.string().nullable(),
  retryMs: z.number().int().positive(),
});

/** Every ingest answer (409 too): the stream, the seq it expects next, whether to send screenshots. */
export const ingestCursorSchema = z.object({
  id: z.string(),
  next: z.number().int().min(0),
  // Someone watches the run now: its step screenshots are worth sending.
  wantShots: z.boolean(),
});

/** What `pnpm sweep --json` prints (engine/scripts/sweep.ts). */
export const sweepReportSchema = z.object({
  environment: z.string(),
  userId: z.number().int().nullable(), // null: nothing to look for (no gateway, or no account)
  dataPrefix: z.string(),
  selection: z.string(),
  candidates: z.array(
    z.object({
      kind: z.string(),
      id: z.number().int(),
      title: z.string(),
      createdAt: z.string().nullable(),
      trashed: z.boolean(),
    })
  ),
  applied: z.boolean(),
  outcomes: z.array(z.string()),
  refusal: z.string().nullable(),
});

export const sweepErrorSchema = z.object({
  error: z.string(),
  needsLogin: z.boolean(),
});
