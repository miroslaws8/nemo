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
  RESOURCE_KINDS,
  targetSchema,
  TEMPLATE_PARAM_TYPES,
} from "../schema";
import type { skillFileSchema } from "../skill-schema";

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
  alias: string;
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
  sessionMetaPath: string;
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

export interface IInstance {
  instanceId: number;
  workspaceId: number;
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

export type IResourceKind = (typeof RESOURCE_KINDS)[number];

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

/** How far a page reaches past the window's right edge (expect_fits_width). */
export interface IOverflow {
  excess: number;
  culprit: string | null;
}

export interface IQaUser {
  id: number;
}

/** A course page as the builder API returns it; learners' URLs use the hash, the API the id. */
export interface ICoursePage {
  id: number;
  hash: string;
}

/** A course a setup created through the API (engine/course-builder.ts). */
export interface ICreatedCourse {
  title: string;
  hubId: number;
  chatId: number;
  instanceId: number;
  workspaceId: number;
  sectionId: number;
  builderUrl: string;
  pages: ICoursePage[];
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
  userId: number;
  dataPrefix: string;
  selection: string;
  candidates: ISweepCandidate[];
  applied: boolean;
  outcomes: string[];
  refusal: string | null;
}

export interface IPage<TItem> {
  items: TItem[];
  lastPage: number;
}

/** A request of the page that the API refused with 429, its rate limit (see engine/rate-limit.ts). */
export interface IRateLimitHit {
  /** e.g. "GET /api/workspaces/1/knowledge-base/files" */
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
