import type { ChildProcess } from "node:child_process";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ILiveEvent } from "../../engine/types";
import type {
  IAgentRun,
  IBranch,
  ICatalogTest,
  IConsoleMode,
  IRetryRequest,
  IRole,
  IRunDetail,
  IRunRecord,
  IRunSource,
  IRunState,
  IRunSelection,
  ISweepResult,
  ITestSource,
} from "../shared/types";
import type { NdjsonTail } from "./ndjson-tail";
import type { AGENT_PROVIDERS, RUNNER_KINDS } from "./settings";

export type { IConsoleMode } from "../shared/types";

/** Who runs branch code (QA_CONSOLE_RUNNERS). */
export type IRunnerKind = (typeof RUNNER_KINDS)[number];
export type IAgentProvider = keyof typeof AGENT_PROVIDERS;

export interface ISpawnedProcess {
  child: ChildProcess;
  pid: number;
}

export interface IProcessRow {
  pid: number;
  ppid: number;
  pgid: number;
}

/** A run the console follows right now (queued runs only have their run.json). */
export interface ILiveRun {
  record: IRunRecord;
  state: IRunState;
  events: ILiveEvent[];
  tail: NdjsonTail | null;
  // Set when this console started the runner; a re-attached runner is watched by its pid.
  child: ChildProcess | null;
  stopTimer: NodeJS.Timeout | null;
  exitWatch: NodeJS.Timeout | null;
  forced: boolean;
  // Cancels its preparation (status "preparing"); null once it runs.
  preparing: AbortController | null;
  // A CI run (record.ci): the seq its stream expects next; null for the console's own runs.
  ingestNext: number | null;
}

/** What a new run will be: its selection and, when it picks tests, their --test-list lines. */
export interface IRunPlan {
  env: string;
  profile: string;
  kind: IRunRecord["kind"];
  parentId: string | null;
  selection: IRunSelection;
  skipNeeds: boolean;
  alongsideCi: boolean;
  listLines: string[] | null;
  source: IRunSource;
  // An agent check (Hermes); null: a run of the YAML tests.
  agent: IAgentRun | null;
}

/** How a run's process starts. */
export interface ILaunch {
  command: ICommandLine;
  env: NodeJS.ProcessEnv;
}

/** What differs between a run of the YAML tests and an agent check (run-manager.ts). */
export interface IRunKind {
  // The run's process, once its tests are ready: its command line and environment.
  launch(record: IRunRecord, prepared: IPreparedRun): ILaunch;
  // A finished run started again (Retry, Run again).
  retryPlan(
    parent: IRunDetail,
    request: IRetryRequest
  ): Omit<IRunPlan, "source">;
  // Its process is over (or never started): what its record learns. What it leaves goes.
  ended(record: IRunRecord): Partial<IRunRecord>;
}

export interface ISseClient {
  response: ServerResponse;
  runId: string | null;
  // Queued and unread beyond this, the tab is dropped (it reconnects and resumes by seq).
  maxBufferedBytes: number;
  // Asked on every ping: false (signed out, session over, role gone) ends the stream.
  stillAllowed: () => boolean;
}

/** Who sends a request. */
export interface IActor {
  // null: not signed in, or a local console (nobody signs in).
  email: string | null;
  // null: no role here (not signed in, or not in the users file).
  role: IRole | null;
  // The session's cookie value; null without one.
  session: string | null;
}

/** Who may call a route (the @Access decorator): anyone ("open"), or a role and the ones above it. */
export type IRouteAccess = "open" | IRole;

/** What the request middleware learnt about a request, for the guard, the filter and the audit. */
export interface IRequestState {
  actor: IActor;
  // Decoded, without the query.
  pathname: string;
  // At the files origin (QA_CONSOLE_FILES_URL): run files by ticket, nothing else, no audit.
  onFilesOrigin: boolean;
  // What went wrong, as the exception filter answered it (for the audit log).
  error: string | null;
}

/** Where a sign-in step sends the browser, and the cookies it sets on the way. */
export interface IRedirect {
  location: string;
  cookies: string[];
}

/** Signing in with the app's IdP (a server console; console/server/auth/access.ts). */
export interface ISignIn {
  // /auth/login: off to the IdP, back to `returnTo` afterwards.
  begin(returnTo: string | null): IRedirect;
  // /auth/callback: a session for a listed person, else the sign-in page with the problem.
  finish(request: IncomingMessage, query: URLSearchParams): Promise<IRedirect>;
  // /auth/logout: ends the session; the cookies to send back.
  signOut(actor: IActor): string[];
}

/** One line of <data dir>/state/audit.ndjson: who did what, or was refused, and how it went. */
export interface IAuditEntry {
  ts: string;
  email: string | null;
  role: IRole | null;
  // "POST /api/runs", "sign-in", "sign-out"
  action: string;
  status: number;
  // The request body, or what went wrong.
  detail: unknown;
}

/**
 * Who may use the console: a local one lets its one user do anything, a server signs people in
 * with their app account (console/server/auth).
 */
export interface IAccessControl {
  // Who sends the request; a signed-in request counts as activity of its session.
  actorOf(request: IncomingMessage): IActor;
  // Whether an open event stream may go on, checked without counting as activity.
  stillAllowed(actor: IActor): boolean;
  // Where a page asked at another address goes instead (the console's own); null: serve it.
  redirectFor(request: IncomingMessage, url: URL): string | null;
  audit(entry: Omit<IAuditEntry, "ts">): void;
  // Writes what is still in memory (the console stops).
  close(): void;
}

export interface ICommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** What holds an environment: a run, a cleanup (both use its one QA account), or a CI step about to start. */
export type IEnvironmentActivity = "run" | "cleanup" | "ci";

/** Sweeps one run's data while nothing else uses the environment (the run manager holds the lock). */
export interface ISweeper {
  sweep(env: string, runId: string, apply: boolean): Promise<ISweepResult>;
}

/** Where a server console gets its tests: the nemo repository. */
export interface IGitSettings {
  url: string;
  // A repository access token (Repositories: Read); only ever in git's environment.
  token: string | null;
}

/** Where Playwright runs for a run or a listing, which CLI, with which variables. */
/** A program with its arguments. */
export interface ICommandLine {
  program: string;
  args: string[];
}

export interface IPreparedRun {
  cwd: string;
  env: NodeJS.ProcessEnv;
  // The command line of `playwright <args>` for this run (as its runner user).
  playwright: (args: string[]) => ICommandLine;
}

/**
 * Who runs branch code (QA_CONSOLE_RUNNERS, console/server/runners.ts): the console's own user,
 * or, on the server, users of their own (one for open environments, one for guarded ones) that
 * cannot read the console's settings, sessions or the other environment's runs.
 */
export interface IRunners {
  // Gets them ready at start; returns what keeps the console from starting (no runner users).
  setUp(): string[];
  // Node with `args`, as the runner of `env`.
  node(env: string, args: string[]): ICommandLine;
  // Any program with `args`, as the runner of `env`.
  command(env: string, program: string, args: string[]): ICommandLine;
  // What the runner of `env` gets on top of its environment (its home).
  variables(env: string): Record<string, string>;
  // Where the runner of `env` keeps its sessions; null: the console's own (<data dir>/auth).
  authDir(env: string): string | null;
  // Lets the runner of `env` write in a folder the console made, and keeps every other runner out.
  share(env: string, folder: string): void;
  // Kills processes (and -groups) of the runner of `env` that the console may not signal itself.
  kill(env: string, targets: number[]): void;
}

/**
 * Where a console's tests come from: the working tree it runs in (local), or a snapshot of the
 * commit each run was started on (server; console/server/workspaces).
 */
export interface IWorkspace {
  readonly testsFrom: ITestSource;
  // The commit a new run or a listing uses: the branch asked for, else the environment's own.
  // `profile` null: an agent check (no profile of tests to check the commit for).
  resolve(
    env: string,
    profile: string | null,
    ref: string | null
  ): Promise<IRunSource>;
  // The commit a retry tests: its parent's (a run from before commits were kept: the branch's).
  retrySource(parent: IRunRecord): Promise<IRunSource>;
  catalog(
    env: string,
    profile: string,
    source: IRunSource,
    refresh: boolean
  ): Promise<ICatalogTest[]>;
  // Keeps the run's commit as long as its folder (a branch may be force-pushed meanwhile).
  pin(runId: string, source: IRunSource): Promise<void>;
  // Gets a run ready; `variables` are its E2E_* settings; the signal cancels it.
  prepare(
    record: IRunRecord,
    variables: Record<string, string>,
    signal: AbortSignal
  ): Promise<IPreparedRun>;
  // The run is over: what was prepared for it goes.
  release(runId: string): void;
  // A file as the run's commit has it (null source: the working tree).
  readFile(source: IRunSource | null, file: string): Promise<string | null>;
  // The names in a folder of the run's commit (none when it has no such folder).
  listFolder(source: IRunSource | null, folder: string): Promise<string[]>;
  branches(): Promise<IBranch[]>;
  // Run folders that were deleted: their commits may go.
  forget(runIds: string[]): Promise<void>;
  // What the console's own tools (the sweep, its login) need to share the runs' sessions.
  toolVariables(): Record<string, string>;
  // At start: what runs left behind, except the runs in `keep` (still going after a crash).
  tidy(keep: ReadonlySet<string>): void;
  // A commit's page with {sha}, or null.
  commitUrl(): string | null;
}

/** How people sign in to a server console: an account of the app, through an OAuth public client. */
export interface ILoginSettings {
  // The IdP's own host: /oauth/authorize and /oauth/token.
  idpUrl: string;
  // The app's API: GET /api/auth (whose token it is) and POST /api/auth/token/revoke.
  idpApiUrl: string;
  clientId: string;
  // <public URL>/auth/callback, as the client has it registered.
  redirectUri: string;
  usersFile: string;
  // Served over https: the cookies are Secure (the session's with the __Host- prefix).
  secureCookies: boolean;
}

/** How this console runs (console/server/config.ts), fixed at start. */
export interface IConsoleSettings {
  mode: IConsoleMode;
  host: string;
  port: number;
  // Where people open it; also the only Host and Origin a server accepts.
  publicUrl: string;
  allowedHosts: ReadonlySet<string>;
  allowedOrigins: ReadonlySet<string>;
  dataDir: string;
  runsDir: string;
  // <data dir>/state: sessions and the audit log.
  stateDir: string;
  maxActiveRuns: number;
  keepRuns: number;
  // Which image this is (QA_CONSOLE_BUILD): a deploy is checked against it.
  build: string;
  // CI may send its runs with one of these (QA_CONSOLE_INGEST_TOKENS); none: it may not.
  ingestTokens: readonly string[];
  // null: nobody signs in (a local console).
  login: ILoginSettings | null;
  // null: the tests come from the working tree (a local console).
  git: IGitSettings | null;
  // null: run files are served from the console's own origin.
  files: IFilesSettings | null;
  // Who runs branch code (QA_CONSOLE_RUNNERS).
  runners: IRunnerKind;
  // Whether it offers environments only a developer's machine reaches (local_only): not a server.
  localOnlyEnvironments: boolean;
  // Agent checks (Hermes): its command and each provider's model key (none: no agent checks).
  agents: IAgentSettings;
  // The S3 bucket skills live in (QA_CONSOLE_SKILLS_*); null: where the mode keeps them.
  skillRegistry: ISkillRegistrySettings | null;
}

export interface ISkillRegistrySettings {
  bucket: string;
  // The S3 API's address, e.g. https://s3.amazonaws.com, and its signing region.
  endpoint: string;
  region: string;
  // Where in the bucket ("" or a folder ending in /), e.g. one of its own for a test.
  prefix: string;
  // Path-style addresses (endpoint/bucket/key), as MinIO wants; Spaces takes bucket.endpoint.
  pathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface IAgentSettings {
  hermes: string;
  // Each provider's key; null: its models are not offered.
  apiKeys: Record<IAgentProvider, string | null>;
  // What checks may spend in a day (UTC), in dollars.
  dailyUsd: number;
}

/** What the console hands an agent check (agents/agent-run.mts), as <run dir>/agent.json. */
export interface IAgentRunConfig {
  runId: string;
  runDir: string;
  env: string;
  skill: string;
  // What the skill gets after the environment ("" for nothing).
  arguments: string;
  model: string;
  // The model's provider as Hermes names it (--provider), and the variable holding its key: the
  // check gets the key in it and hands it to Hermes in the Hermes home's .env.
  provider: string;
  keyVariable: string;
  // Whether the provider bills writing to its cache; false: those tokens count as new input.
  cacheWrites: boolean;
  // What the titles of the data the check creates start with (its Clean up finds them by it).
  dataPrefix: string;
  // The hermes command.
  hermes: string;
  // The environment's agent home (HOME) and its Hermes home inside (HERMES_HOME).
  home: string;
  hermesHome: string;
  // hermes/ of the run's tests: the skills and their shared contract.
  hermesSource: string;
  // The folder of a skill from the console's store (its SKILL.md), which replaces the commit's
  // skill of that name; null: the commit's skill runs.
  storedSkill: string | null;
  maxTurns: number;
  runBudgetSeconds: number;
  toolsets: string[];
  // The browser window, "width,height".
  windowSize: string;
  // The app's address the skills test (QA_<prefix>_URL), as the console's config has it.
  baseUrl: { variable: string; url: string };
  // Dollars per million tokens, for the estimate.
  usdPerMillion: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  // Where the QA account signs in, and the variables holding it (its password goes to Hermes's
  // vault, never to the agent); null: the environment names no login_origin.
  login: {
    origin: string;
    identifierVariable: string;
    passwordVariable: string;
  } | null;
}

/** Where run files are served (QA_CONSOLE_FILES_URL): an origin of their own. */
export interface IFilesSettings {
  // The origin, e.g. https://qa-files.example.com
  url: string;
  // Its Host header value.
  host: string;
}
