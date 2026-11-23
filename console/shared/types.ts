import type { z } from "zod";
import type {
  ILiveTest,
  INoticeKind,
  IStepKind,
  IYamlLocation,
} from "../../engine/types";
import type {
  ACTIVE_RUN_STATUSES,
  addSkillRequestSchema,
  diffLineSchema,
  replaceSkillRequestSchema,
  promoteSkillRequestSchema,
  SKILL_ORIGINS,
  SKILL_STORE_KINDS,
  skillDeletedSchema,
  skillPromotionSchema,
  skillStoreInfoSchema,
  SKILL_SAFETIES,
  skillCheckRequestSchema,
  skillCheckSchema,
  skillDetailSchema,
  skillExampleSchema,
  skillListSchema,
  skillProblemSchema,
  skillSummarySchema,
  skillTemplateListSchema,
  skillVersionSchema,
  catalogTestSchema,
  cleanupRequestSchema,
  consoleConfigSchema,
  environmentInfoSchema,
  logChunkSchema,
  profileInfoSchema,
  RETRY_SCOPES,
  retryRequestSchema,
  RUN_STATUSES,
  runCountsSchema,
  runRecordSchema,
  runSelectionSchema,
  sourceSnippetSchema,
  startRunRequestSchema,
  stopRequestSchema,
  sweepReportSchema,
  tierInfoSchema,
  ACTIVE_CI_STATUSES,
  CI_STATUSES,
  CI_STEP_STATUSES,
  ciDetailSchema,
  ciLogSchema,
  ciOverviewSchema,
  ciPipelineSchema,
  ciReportSchema,
  ciRerunRequestSchema,
  ciStepSchema,
  ciTestCaseSchema,
  CONSOLE_MODES,
  meSchema,
  ROLES,
  SIGN_IN_PROBLEMS,
  branchListSchema,
  catalogSchema,
  ciRunSchema,
  agentRunSchema,
  agentSkillsSchema,
  agentSpendSchema,
  agentsInfoSchema,
  agentUsageSchema,
  ingestClaimRequestSchema,
  ingestAgentChecksRequestSchema,
  ingestAgentChecksSchema,
  ingestClaimSchema,
  ingestCursorSchema,
  ingestEventsRequestSchema,
  ingestStreamRequestSchema,
  runSourceSchema,
  startAgentRunRequestSchema,
  TEST_SOURCES,
} from "./api";

export type {
  ILiveEvent,
  INoticeKind,
  IYamlLocation,
} from "../../engine/types";

export type IConsoleMode = (typeof CONSOLE_MODES)[number];
export type IRole = (typeof ROLES)[number];
export type IMe = z.infer<typeof meSchema>;
export type ISignInProblem = (typeof SIGN_IN_PROBLEMS)[number];
export type ITestSource = (typeof TEST_SOURCES)[number];
export type IRunSource = z.infer<typeof runSourceSchema>;
export type IBranch = z.infer<typeof branchListSchema>[number];
export type ICatalog = z.infer<typeof catalogSchema>;
export type ICiRun = z.infer<typeof ciRunSchema>;
export type IIngestStreamRequest = z.infer<typeof ingestStreamRequestSchema>;
export type IIngestEventsRequest = z.infer<typeof ingestEventsRequestSchema>;
export type IIngestCursor = z.infer<typeof ingestCursorSchema>;
export type IIngestClaimRequest = z.infer<typeof ingestClaimRequestSchema>;
export type IIngestClaim = z.infer<typeof ingestClaimSchema>;
export type IIngestAgentChecksRequest = z.infer<
  typeof ingestAgentChecksRequestSchema
>;
export type IIngestAgentChecks = z.infer<typeof ingestAgentChecksSchema>;
export type IAgentQueuedBy = NonNullable<IAgentRun["queuedBy"]>;
export type IRunStatus = (typeof RUN_STATUSES)[number];
export type IActiveRunStatus = (typeof ACTIVE_RUN_STATUSES)[number];
export type IRetryScope = (typeof RETRY_SCOPES)[number];
export type IRunCounts = z.infer<typeof runCountsSchema>;
export type IRunSelection = z.infer<typeof runSelectionSchema>;
export type IRunRecord = z.infer<typeof runRecordSchema>;
export type IStartRunRequest = z.infer<typeof startRunRequestSchema>;
export type IRetryRequest = z.infer<typeof retryRequestSchema>;
export type IStopRequest = z.infer<typeof stopRequestSchema>;
export type ICleanupRequest = z.infer<typeof cleanupRequestSchema>;
export type ISweepResult = z.infer<typeof sweepReportSchema>;
export type IEnvironmentInfo = z.infer<typeof environmentInfoSchema>;
export type ITierInfo = z.infer<typeof tierInfoSchema>;
export type IProfileInfo = z.infer<typeof profileInfoSchema>;
export type IConsoleConfig = z.infer<typeof consoleConfigSchema>;
export type IAgentRun = z.infer<typeof agentRunSchema>;
export type IAgentUsage = z.infer<typeof agentUsageSchema>;
export type IAgentsInfo = z.infer<typeof agentsInfoSchema>;
export type IAgentSkills = z.infer<typeof agentSkillsSchema>;
export type ISkillOrigin = (typeof SKILL_ORIGINS)[number];
export type ISkillSafety = (typeof SKILL_SAFETIES)[number];
export type ISkillVersion = z.infer<typeof skillVersionSchema>;
export type ISkillPromotion = z.infer<typeof skillPromotionSchema>;
export type ISkillDeleted = z.infer<typeof skillDeletedSchema>;
export type IPromoteSkillRequest = z.infer<typeof promoteSkillRequestSchema>;
export type ISkillStoreKind = (typeof SKILL_STORE_KINDS)[number];
export type ISkillStoreInfo = z.infer<typeof skillStoreInfoSchema>;
export type ISkillSummary = z.infer<typeof skillSummarySchema>;
export type ISkillList = z.infer<typeof skillListSchema>;
export type ISkillProblem = z.infer<typeof skillProblemSchema>;
export type ISkillDetail = z.infer<typeof skillDetailSchema>;
export type ISkillCheckRequest = z.infer<typeof skillCheckRequestSchema>;
export type ISkillCheck = z.infer<typeof skillCheckSchema>;
export type IDiffLine = z.infer<typeof diffLineSchema>;
export type IAddSkillRequest = z.infer<typeof addSkillRequestSchema>;
export type IReplaceSkillRequest = z.infer<typeof replaceSkillRequestSchema>;
export type ISkillExample = z.infer<typeof skillExampleSchema>;
export type ISkillTemplateList = z.infer<typeof skillTemplateListSchema>;
export type IAgentSpend = z.infer<typeof agentSpendSchema>;
export type IStartAgentRunRequest = z.infer<typeof startAgentRunRequestSchema>;
export type ICatalogTest = z.infer<typeof catalogTestSchema>;
export type ILogChunk = z.infer<typeof logChunkSchema>;
export type ISourceSnippet = z.infer<typeof sourceSnippetSchema>;
export type ICiStatus = (typeof CI_STATUSES)[number];
export type IActiveCiStatus = (typeof ACTIVE_CI_STATUSES)[number];
export type ICiStepStatus = (typeof CI_STEP_STATUSES)[number];
export type ICiPipeline = z.infer<typeof ciPipelineSchema>;
export type ICiOverview = z.infer<typeof ciOverviewSchema>;
export type ICiStep = z.infer<typeof ciStepSchema>;
export type ICiTestCase = z.infer<typeof ciTestCaseSchema>;
export type ICiReport = z.infer<typeof ciReportSchema>;
export type ICiDetail = z.infer<typeof ciDetailSchema>;
export type ICiLog = z.infer<typeof ciLogSchema>;
export type ICiRerunRequest = z.infer<typeof ciRerunRequestSchema>;

export type ITestStatus =
  | "queued"
  | "running"
  | "passed"
  | "failed"
  | "flaky"
  | "skipped"
  | "interrupted"
  | "timedOut";

export interface IStepState {
  stepId: string;
  parentId: string | null;
  depth: number;
  title: string;
  kind: IStepKind;
  yaml: IYamlLocation | null;
  // "interrupted": the run was stopped while the step went (see settleRun).
  status: "running" | "passed" | "failed" | "interrupted";
  startedAt: string;
  ms: number | null;
  error: string | null;
  note: string | null;
}

export interface ITestShot {
  path: string;
  stepId: string | null;
  seq: number;
}

export interface ITestError {
  message: string;
  yaml: IYamlLocation | null;
}

/** One test as the console shows it: its latest attempt. */
export interface ITestState extends ILiveTest {
  status: ITestStatus;
  retry: number;
  lane: number | null;
  startedAt: string | null;
  ms: number | null;
  steps: IStepState[];
  currentStepId: string | null;
  // The latest screenshot (relative to the run folder) and the seq it came with: the file is
  // overwritten per step, so the seq tells a browser to load it again.
  shot: string | null;
  shotVersion: number | null;
  // Every screenshot file of the attempt, oldest first, with the step that saved it and the seq
  // it came with: one for a YAML test (its one file, overwritten), each of them for an agent check.
  shots: ITestShot[];
  errors: ITestError[];
  annotations: { type: string; description: string | null }[];
  attachments: { name: string; path: string }[];
}

/** How often one kind of notice came in a run, and the latest one. */
export interface INoticeSummary {
  count: number;
  firstAt: string;
  lastAt: string;
  lastMessage: string;
  lastTestId: string;
}

export type IRunPhase =
  | "starting"
  | "running"
  | "passed"
  | "failed"
  | "timedout"
  | "interrupted";

/** A run rebuilt from its events (console/shared/reducer.ts). */
export interface IRunState {
  runId: string | null;
  env: string | null;
  profile: string | null;
  workers: number;
  phase: IRunPhase;
  order: string[];
  tests: Record<string, ITestState>;
  // Worker lane → the test running in it now.
  lanes: Record<string, string | null>;
  counts: IRunCounts;
  startedAt: string | null;
  endedAt: string | null;
  ms: number | null;
  runErrors: string[];
  // Rate limits and a lost session, for the run page's banners.
  notices: Record<INoticeKind, INoticeSummary | null>;
  lastSeq: number;
  // When its newest event was written (a CI run that goes quiet says so).
  lastEventAt: string | null;
}

/** GET /api/runs/:id */
export interface IRunDetail {
  run: IRunRecord;
  state: IRunState;
}
