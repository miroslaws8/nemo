import type { Locator, Page, TestInfo } from "@playwright/test";
import type { z } from "zod";
import type { ApiClient } from "../api-client";
import type { e2eConfigSchema, SKILL_CHANNELS } from "../config";
import type {
  liveEventSchema,
  liveTestSchema,
  NOTICE_KINDS,
  STEP_KINDS,
  yamlLocationSchema,
} from "../reporters/live-events";
import type {
  durationSchema,
  LOCATOR_KEYS,
  targetSchema,
  TEMPLATE_PARAM_TYPES,
} from "../schema";
import type { skillFileSchema } from "../skill-schema";
import type { judgeAnswerSchema } from "../ai/json-answer";
import type { AI_PROTOCOLS } from "../ai/settings-schema";

export type IE2eConfig = z.infer<typeof e2eConfigSchema>;
export type ICleanupPolicy = IE2eConfig["cleanup"]["on_pass"];

/** One line of a run's events.ndjson (engine/reporters/live-events.ts). */
export type ILiveEvent = z.infer<typeof liveEventSchema>;
type IWithoutStamp<TEvent> = TEvent extends unknown
  ? Omit<TEvent, "seq" | "ts">
  : never;
/** An event before the writer numbers and stamps it. */
export type ILiveEventPayload = IWithoutStamp<ILiveEvent>;
export type ILiveTest = z.infer<typeof liveTestSchema>;
export type IYamlLocation = z.infer<typeof yamlLocationSchema>;
export type IStepKind = (typeof STEP_KINDS)[number];
export type ISkillChannel = (typeof SKILL_CHANNELS)[number];
export type INoticeKind = (typeof NOTICE_KINDS)[number];
/** Tells the people watching the run about something (engine/notices.ts). */
export type INotify = (kind: INoticeKind, message: string) => void;

/** Files of one run (engine/run-dir.ts); null where the run does not write that file. */
export interface IRunPaths {
  runDir: string | null;
  htmlReport: string;
  jsonReport: string | null;
  junitReport: string | null;
  artifacts: string;
  events: string | null;
  shots: string | null;
}

export interface IEnvironment {
  name: string;
  baseUrl: string;
  envPrefix: string;
  apiUrl: string | null;
  allowedTiers: string[] | null;
  // It has a QA account (`credentials`): its runs sign in first. Otherwise they run signed out.
  signsIn: boolean;
  // The Playwright device its tests run as (`device`, e.g. "Pixel 7"); null: a desktop browser.
  device: string | null;
  // Its folder under tests/ (`tests`); null: every test no other environment claims.
  testsFolder: string | null;
  guarded: boolean;
  // The branch a server QA console runs its tests from.
  branch: string;
  // Only a developer's machine reaches it: a server QA console leaves it out.
  localOnly: boolean;
  // The origin of its sign-in page (agent checks fill the password there); null: not set.
  loginOrigin: string | null;
  // Which version of a stored skill its agent checks run (skill_channel).
  skillChannel: ISkillChannel;
  storageStatePath: string;
  // The session cookie holding the API's Bearer token (api_token_cookie); null: cookies only.
  apiTokenCookie: string | null;
  // Where the login starts (login.path) and the submit button's name (login.submit; null: the
  // form's own submit button).
  loginPath: string;
  loginSubmit: string | null;
  // The path the app lands on once signed in (login.done); null: anywhere past the form.
  loginDone: string | null;
}

export interface IResolvedTier {
  name: string;
  workers: number;
  retries: number;
  needs: string[];
  readOnly: boolean;
}

export interface IRunSelection {
  environment: IEnvironment;
  profileName: string;
  tiers: IResolvedTier[];
  skippedTiers: string[];
  globalTimeoutMs: number;
}

export interface IJsonSchemaFile {
  path: string;
  content: string;
}

/** A file the repo keeps written from another (a skill's SKILL.md from its skill.yaml). */
export interface IGeneratedFile {
  path: string;
  content: string;
}

/** A Hermes skill as written: hermes/skills/<name>/skill.yaml (engine/skill-schema.ts). */
export type ISkillFile = z.infer<typeof skillFileSchema>;

/** What is wrong with a skill.yaml, and where (line and column null: the file as a whole). */
export interface ISkillProblem {
  severity: "error" | "warning";
  message: string;
  // The field it is about, as YAML keys and list indexes; [] for the file.
  path: IYamlNodePath;
  line: number | null;
  column: number | null;
}

/** A skill.yaml read: the skill and its SKILL.md once it has no errors, and every problem found. */
export interface ISkillParse {
  skill: ISkillFile | null;
  skillMd: string | null;
  problems: ISkillProblem[];
}

export interface ICredentials {
  email: string;
  password: string;
}

export type IVariables = Record<string, unknown>;

export interface IInterpolationOptions {
  strict: boolean;
}

export type IDuration = z.infer<typeof durationSchema>;

export type ITarget = z.infer<typeof targetSchema>;

export type ILocatorKey = (typeof LOCATOR_KEYS)[number];

export type IUrlMatchKey = "contains" | "starts_with" | "matches";

export type ILocatorResolver = (
  scope: Page | Locator,
  value: string,
  target: ITarget
) => Locator;

export interface IStepModifiers {
  name?: string;
  when?: string;
  unless?: string;
}

/** Where a step was written: `file` is relative to the repo root, `label` is "file:line" for messages. */
export interface IStepLocation {
  file: string;
  line: number | null;
  label: string;
}

interface IStepNodeBase extends IStepModifiers {
  position: number;
  location: IStepLocation;
}

export interface IActionStep extends IStepNodeBase {
  kind: "action";
  keyword: string;
  args: unknown;
}

export interface ITemplateCallStep extends IStepNodeBase {
  kind: "template";
  template: string;
  args: unknown;
}

/** Runs `steps` again and again until `until` (a target, may hold ${…}) is visible. */
export interface IRepeatStep extends IStepNodeBase {
  kind: "repeat";
  until: unknown;
  max: number;
  steps: IStepNode[];
}

export type IStepNode = IActionStep | ITemplateCallStep | IRepeatStep;

export type ITemplateParamType = (typeof TEMPLATE_PARAM_TYPES)[number];

export interface ITemplateParam {
  name: string;
  type: ITemplateParamType;
  required: boolean;
  defaultValue: unknown;
  description: string | null;
}

export interface ITemplateSignature {
  name: string;
  file: string;
  title: string | null;
  description: string | null;
  params: ITemplateParam[];
}

export interface ITemplateDefinition extends ITemplateSignature {
  steps: IStepNode[];
}

/** A template file read and checked, before its steps are normalized. */
export interface IParsedTemplateFile {
  signature: ITemplateSignature;
  document: IYamlDocument;
  rawSteps: Record<string, unknown>[];
}

/** How a block of steps runs: its template params (null outside templates) and step numbering. */
export interface IStepFrame {
  params: IVariables | null;
  numberPrefix: string;
  callChain: string[];
}

export type IYamlNodePath = (string | number)[];

/** A place in a YAML text: 1-based line and column. */
export interface IYamlPosition {
  line: number;
  column: number;
}

export interface IYamlDocument {
  data: unknown;
  lineOf: (nodePath: IYamlNodePath) => number | null;
  /** Where a node starts, or (with `key`) the key of a mapping's entry; null when it is absent. */
  positionOf: (nodePath: IYamlNodePath, key?: string) => IYamlPosition | null;
  /** The field or list item at a place in the text ([] for none: the file as a whole). */
  pathAt: (line: number, column: number) => IYamlNodePath;
}

/** A YAML text read without throwing: its document, or its first syntax error. */
export type IYamlSource =
  | { document: IYamlDocument; error: null }
  | {
      document: null;
      error: { message: string; position: IYamlPosition | null };
    };

/** What step normalization needs to know about the file the steps come from. */
export interface INormalizeScope {
  file: string;
  document: IYamlDocument;
  templates: ReadonlyMap<string, ITemplateSignature>;
  declaredParams: ReadonlySet<string> | null;
}

/** One entry of a test file's `setup:` list. */
export interface ISetupCall {
  name: string;
  args: unknown;
}

export interface ITestCase {
  title: string;
  file: string;
  setup: ISetupCall[];
  timeoutMs: number;
  skip: boolean;
  only: boolean;
  steps: IStepNode[];
  variables: IVariables;
}

export interface ITestSuite {
  file: string;
  suite: string;
  tier: string;
  tags: string[];
  cases: ITestCase[];
}

// A kind of record the app's gateways know (engine/cleanup/gateways.ts), e.g. "order".
export type IResourceKind = string;

/** Something a test created; `id` null means "find it by its exact title" at cleanup. */
export interface ITrackedResource {
  kind: IResourceKind;
  id: number | null;
  title: string;
  url: string | null;
}

export interface IResourceRegistry {
  track: (resource: ITrackedResource) => void;
  list: () => readonly ITrackedResource[];
}

/** A record read back from the API, with what the deletion guard checks. */
export interface IOwnedRecord {
  kind: IResourceKind;
  id: number;
  title: string;
  ownerId: number | null;
  createdAt: Date | null;
  trashed: boolean;
}

/** How one kind of record is read, listed (the test user's own) and deleted. */
export interface IResourceGateway {
  kind: IResourceKind;
  fetch: (api: ApiClient, id: number) => Promise<IOwnedRecord | null>;
  listOwned: (api: ApiClient, ownerId: number) => Promise<IOwnedRecord[]>;
  remove: (api: ApiClient, record: IOwnedRecord) => Promise<void>;
}

export interface IDeletionOutcome {
  resource: ITrackedResource;
  record: IOwnedRecord | null;
  deleted: boolean;
  reason: string | null;
}

export type IAiProtocolName = (typeof AI_PROTOCOLS)[number];

/** One model of the `ai` section, by role (e.g. "fast"). */
export interface IAiModelSettings {
  protocol: IAiProtocolName;
  model: string;
  // Another server of the protocol (OpenRouter, Ollama, …); null: the protocol's own.
  baseUrl: string | null;
  // The variable holding its key; null: the server takes none.
  keyVariable: string | null;
  vision: boolean;
  usdPerMillion: { input: number; output: number };
}

/** What a model is sent: text and screenshots. */
export type IModelPart =
  | { type: "text"; text: string }
  | { type: "image"; png: Buffer };

/** A tool the model may call: its JSON Schema comes from a zod schema (z.toJSONSchema). */
export interface IModelTool {
  name: string;
  description: string;
  schema: Record<string, unknown>;
}

/** A tool call of a reply; `input` is the parsed JSON, or the raw text when it does not parse. */
export interface IModelToolCall {
  id: string;
  name: string;
  input: unknown;
}

/** One message of a conversation with a model. */
export type IModelMessage =
  | { role: "user"; parts: IModelPart[] }
  | { role: "assistant"; text: string; toolCalls: IModelToolCall[] }
  | { role: "tool"; results: { callId: string; text: string }[] };

export interface IModelRequest {
  system: string;
  messages: IModelMessage[];
  // None: a plain answer (the judge).
  tools: IModelTool[];
  maxTokens: number;
  // A call that takes longer is given up (and counts as an error of its attempt).
  timeoutMs: number;
}

export interface IModelUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface IModelReply {
  text: string;
  toolCalls: IModelToolCall[];
  usage: IModelUsage;
  // The model declined to answer (a safety refusal): no answer to read.
  refused: boolean;
}

/** One way of talking to models (engine/ai/protocols/): OpenAI-compatible, Anthropic, …. */
export interface IModelProtocol {
  complete(
    settings: IAiModelSettings,
    apiKey: string | null,
    request: IModelRequest,
    fetchImpl?: typeof fetch
  ): Promise<IModelReply>;
}

/** A model's answer to an ai_check (engine/ai/json-answer.ts). */
export type IJudgeAnswer = z.infer<typeof judgeAnswerSchema>;
export type IVerdict = IJudgeAnswer["verdict"];
export type IRegion = IJudgeAnswer["regions"][number];

/** What the judge shows a model: the page as a user sees it, and as assistive tech reads it. */
export interface IEvidence {
  png: Buffer;
  aria: string;
  url: string;
  // Where the screenshot starts on the page, in CSS pixels (0: the top).
  top: number;
  // The text the capture was centred on (the model's look_at), and whether the page has it.
  focus: { text: string; found: boolean } | null;
}

/** One look by one model; `error` when it gave no answer (provider error, no key, budget). */
export interface IJudgeAttempt {
  model: string;
  // The text this look was centred on (an earlier answer's look_at); null: the page's top.
  lookedAt: string | null;
  answer: IJudgeAnswer | null;
  error: string | null;
}

export type IJudgementOutcome = IVerdict | "not_judged";

/** The judge's decision on an ai_check, with every attempt that led to it. */
export interface IJudgement {
  outcome: IJudgementOutcome;
  final: IJudgeAnswer | null;
  attempts: IJudgeAttempt[];
}

/** A role's model, ready to call (engine/ai/client.ts). */
export interface IModelClient {
  readonly role: string;
  readonly model: string;
  complete(request: IModelRequest): Promise<IModelReply>;
}

/** What a run's AI calls cost so far, shared by its workers (engine/ai/spend.ts). */
export interface IRunSpend {
  total(): number;
  add(usd: number, model: string): void;
}

export interface IJudgeSettings {
  model: string;
  escalateTo: string | null;
  minConfidence: number;
  retries: number;
  blocking: boolean;
}

/** The AI settings of one run (engine/ai/settings.ts); null where AI is off. */
export interface IAiSettings {
  models: Record<string, IAiModelSettings>;
  judge: IJudgeSettings;
  budgetUsdPerRun: number;
  // pnpm author's settings; null: no `ai.author` section.
  author: IAuthorSettings | null;
}

/** A step the test author kept: it worked; `submits` when it sent a form (it writes data). */
export interface IAuthorStep {
  keyword: string;
  args: unknown;
  submits: boolean;
}

/** One tool call of the author and what came of it. */
export interface IAuthorTurn {
  tool: string;
  input: unknown;
  ok: boolean;
  result: string;
}

export interface IAuthorResult {
  outcome: "done" | "impossible" | "incomplete";
  summary: string;
  kept: IAuthorStep[];
  turns: IAuthorTurn[];
}

/** What the author loop is given: the model, a look at the page, and a way to run a step. */
export interface IAuthorDeps {
  client: IModelClient;
  observe: () => Promise<IEvidence>;
  // Runs the step (guards first): the error, or null; and whether it submitted a form.
  act: (step: {
    keyword: string;
    args: unknown;
  }) => Promise<{ error: string | null; submits: boolean }>;
  maxActions: number;
}

export interface IAuthorSettings {
  model: string;
  maxActions: number;
  avoid: string[];
}

/** How far a page reaches past the window's right edge (expect_fits_width). */
export interface IOverflow {
  excess: number;
  culprit: string | null;
}

export interface IQaUser {
  id: number;
}

/** ci/wait-for-deploy.ts: the expected build serves, a newer one already serves, or neither in time. */
export type IReadyOutcome = "ready" | "superseded" | "timeout";

export type IDeployTargetName = "frontend" | "api";

export interface IDeployTarget {
  name: IDeployTargetName;
  url: string;
  expectedBuild: string | null;
}

export interface IBuildProbe {
  reachable: boolean;
  build: string | null;
}

export interface IReadyReport {
  outcome: IReadyOutcome;
  environment: string;
  expected: Partial<Record<IDeployTargetName, string>>;
  served: Partial<Record<IDeployTargetName, string | null>>;
  waitedSeconds: number;
}

/** The part of Playwright's JSON report that ci/notify-slack.ts reads. */
export interface IReportAnnotation {
  type: string;
  description?: string;
}

export interface IReportResult {
  status: string;
  error?: { message?: string };
  annotations?: IReportAnnotation[];
}

export interface IReportTest {
  status: string;
  annotations?: IReportAnnotation[];
  results: IReportResult[];
}

export interface IReportSpec {
  title: string;
  tests: IReportTest[];
}

export interface IReportSuite {
  specs?: IReportSpec[];
  suites?: IReportSuite[];
}

export interface IJsonReport {
  stats: {
    expected: number;
    unexpected: number;
    flaky: number;
    skipped: number;
  };
  suites: IReportSuite[];
}

export interface IFailedTest {
  title: string;
  file: string | null;
  error: string;
}

export interface ISweepOptions {
  environmentName: string;
  olderThan: IDuration | null;
  /** Only the data of this run (titles "<data_prefix><run id> …"), whatever its age. */
  runId: string | null;
  apply: boolean;
  /** Print one JSON object (for the console) instead of text. */
  json: boolean;
}

/** Which of the test user's records a sweep is about, and how to say so. */
export interface ISweepSelection {
  label: string;
  matches: (record: IOwnedRecord) => boolean;
}

/** A record a sweep would delete, as it is printed (dates as ISO strings). */
export interface ISweepCandidate
  extends Omit<IOwnedRecord, "ownerId" | "createdAt"> {
  createdAt: string | null;
}

/** What a sweep found and did; printed as text, or as JSON with --json. */
export interface ISweepReport {
  environment: string;
  userId: number | null;
  dataPrefix: string;
  selection: string;
  candidates: ISweepCandidate[];
  applied: boolean;
  outcomes: string[];
  refusal: string | null;
}

/** A request of the page that the API refused with 429, its rate limit (see engine/rate-limit.ts). */
export interface IRateLimitHit {
  /** e.g. "GET /api/orders" */
  request: string;
  /** When the API takes requests again (epoch ms). */
  retryAt: number;
}

/** What went wrong during a test from a user's point of view (see engine/error-monitor.ts). */
export interface IErrorMonitor {
  errors: () => readonly string[];
  /** 429s since the last goto: the run's pace, not app errors, but they explain a wrong page. */
  rateLimitHits: () => readonly IRateLimitHit[];
  clearRateLimitHits: () => void;
}

export interface IRunContext {
  page: Page;
  api: ApiClient;
  resources: IResourceRegistry;
  errorMonitor: IErrorMonitor;
  environment: IEnvironment;
  testInfo: TestInfo;
  variables: IVariables;
  aiCheckCount: number;
  // What the test did so far, one line per step (the AI judge reads it).
  stepLog: string[];
  // The run's AI (engine/ai/); null where AI is off.
  ai: IAiRunContext | null;
}

/** The AI of one worker: the settings and the judge's models. */
export interface IAiRunContext {
  settings: IAiSettings;
  primary: IModelClient;
  escalation: IModelClient | null;
}

export interface IE2eTestFixtures {
  api: ApiClient;
  resources: IResourceRegistry;
  errorMonitor: IErrorMonitor;
}

export interface IE2eWorkerFixtures {
  // Asked of the API once per worker, and only when a test has data to delete.
  qaUser: () => Promise<IQaUser>;
}

export interface IStepDefinition<TArgs> {
  keyword: string;
  schema: z.ZodType<TArgs>;
  // Steps that register data for cleanup may not be used in a read-only tier.
  createsData?: boolean;
  // Steps that only look at the page (no click, typing or data), so running them twice changes
  // nothing: the runner may run them again after the API rate limit (see runSteps).
  observesOnly?: boolean;
  describe: (args: TArgs) => string;
  run: (args: TArgs, context: IRunContext) => Promise<void>;
}

export interface IRegisteredStep {
  keyword: string;
  schema: z.ZodType;
  createsData: boolean;
  observesOnly: boolean;
  describe: (args: unknown) => string;
  run: (args: unknown, context: IRunContext) => Promise<void>;
}

/** `creates` setups write data, so read-only tiers may not use them. */
export type ISetupMode = "creates" | "readonly";

export interface ISetupDefinition<TParams> {
  name: string;
  mode: ISetupMode;
  params: z.ZodType<TParams>;
  run: (params: TParams, context: IRunContext) => Promise<void>;
}

export interface IRegisteredSetup {
  name: string;
  mode: ISetupMode;
  params: z.ZodType;
  run: (args: unknown, context: IRunContext) => Promise<void>;
}

export type ITestBody = (
  fixtures: IE2eTestFixtures & { page: Page },
  testInfo: TestInfo
) => Promise<void>;
