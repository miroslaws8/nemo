import type {
  ISkillDetail,
  ISkillOrigin,
  ISkillSafety,
  INoticeSummary,
  IRetryScope,
  IRunCounts,
  ISignInProblem,
  ITestStatus,
  IYamlLocation,
} from "@shared/types";
import type { Component } from "vue";

/** The colour family of a status: the only colours the console uses. */
export type ITone = "pass" | "fail" | "flaky" | "run" | "stop" | "idle";

/** The drawings of a status (StatusGlyph.vue). */
export const GLYPHS = [
  "check",
  "cross",
  "bang",
  "pie",
  "dashed",
  "square",
  "minus",
  "pause",
] as const;
export type IGlyph = (typeof GLYPHS)[number];

/** How a run or test status reads: its words, colour and glyph. */
export interface IStatusLook {
  label: string;
  tone: ITone;
  glyph: IGlyph;
  // Something is still going on: the glyph spins.
  live: boolean;
}

/** Literal Tailwind classes of one tone (Tailwind only finds whole class names in the source). */
export interface IToneClasses {
  text: string;
  bar: string;
  soft: string;
}

/** One kind of count in a run's progress bar and legend. */
export interface ICountSegment {
  key: Exclude<keyof IRunCounts, "total">;
  label: string;
  tone: ITone;
}

/** The browser's link to the console's event stream. */
export type IConnectionState = "connecting" | "open" | "lost";

/** Runs or pipelines of one day in the sidebar (or the ones going now). */
export interface IGroup<TItem> {
  title: string;
  items: TItem[];
}

/** The tests list's filter. */
export type ITestFilter =
  | "all"
  | "failed"
  | "flaky"
  | "running"
  | "passed"
  | "rest";

/** Which buttons a run's header offers, by its status; a CI run's are on its pipeline page. */
export type IRunActionSet = "dequeue" | "stop" | "force" | "finished" | "ci";

/** Who runs a run: the console, or a CI pipeline the console follows. */
export type IRunOrigin = "console" | "ci";

/** A retry that asks first: prod's name, or whether to skip the tiers its tests need. */
export interface IRetryDraft {
  scope: IRetryScope;
  testIds: string[] | null;
  title: string;
  description: string;
  // Tiers that run in full first unless skipped; empty: nothing to choose.
  needTiers: string[];
  guarded: boolean;
}

/** Where the "Clean up" dialog is. */
export type ICleanupPhase =
  | "looking"
  | "found"
  | "deleting"
  | "done"
  | "failed";

/** How the run page shows one kind of notice. */
export interface INoticeBanner {
  title: string;
  icon: Component;
  tone: ITone;
  // How a screen reader tells it when it shows: at once (alert) or when idle (status).
  role: "alert" | "status";
  // Its one line beside the title: what it means for the run, for a run still going or over.
  line: (notice: INoticeSummary, going: boolean) => string;
  // What its details add: how it happened, and what to do about it.
  details: (notice: INoticeSummary, going: boolean) => string[];
}

/** A link to one file a test attached (trace, screenshot, error context…). */
export interface IAttachmentLink {
  label: string;
  href: string;
  icon: Component;
}

/** How a new run picks its tests. */
export type ISelectionMode = "all" | "pick" | "tags";

/** What a new run runs: the YAML tests, an agent check (Hermes with a skill), or writing a test. */
export type IRunKindChoice = "tests" | "agent" | "author";

/** A property of a new run shown as a pill under its body, where its kind of run takes it. */
export type INewRunPill =
  | "profile"
  | "branch"
  | "model"
  | "skipNeeds"
  | "alongsideCi";

/** A tag of the catalog and how many tests carry it. */
export interface ITagCount {
  tag: string;
  count: number;
}

/** Where the tab stands with the console: finding out, in, or shown the sign-in page. */
export type ISessionState = "checking" | "signed-in" | "signed-out";

/** What the sign-in page says: why a sign-in failed, that you signed out, or that it went round. */
export type ISignInNotice = ISignInProblem | "signed-out" | "stuck";

/** The sign-in page's words for one notice. */
export interface ISignInMessage {
  title: string;
  text: string;
  // Its banner's tone: idle for news (signed out), flaky for a step to take, fail for a refusal.
  tone: ITone;
}

/** Whether the signed-in person may do something, and if not, why (shown by the button). */
export interface IPermission {
  allowed: boolean;
  reason: string | null;
}

/** The words that change with where tests run: this Mac, or the console's server. */
export interface IModeWords {
  runsTab: string;
  newRun: string;
  // Who started a run is a column of the runs list (a local console has no people).
  showsPerson: boolean;
}

/** What a console's skill store means for its Skills pages (by where it keeps skills). */
export interface IStoreWords {
  // What adding a skill, and giving one a new version, does ({name}, {version} filled in).
  addSkill: string;
  replaceSkill: string;
}

/** A skill's fields as its skill.yaml has them (the server read them). */
export type ISkillFields = NonNullable<ISkillDetail["fields"]>;

/** A skill as its form holds it: every field there, empty when unused (lib/skill-draft.ts). */
export interface ISkillDraft {
  description: string;
  title: string;
  summary: string;
  safety: ISkillSafety;
  ai_credits: boolean;
  side_effects: string;
  arguments: string;
  start_at: string;
  rules: string[];
  sections: { title: string; text: string }[];
  steps: string[];
  // null: the agent saves none (a script of the skill does).
  screenshots: { folder: string; files: string[] } | null;
  report: string[];
  pass_if: string[];
  fail_if: string[];
  not_a_failure: string[];
}

/** A page of the console a skill's title bar leads to: Use as template, New version…. */
export interface ISkillLinkAction {
  label: string;
  to: string;
  icon: Component;
}

/** A place the sidebar leads to: Runs, CI, Skills. */
/** How a skill that another of its name shadows says so: the other one runs. */
export interface IShadowedWords {
  // Its chip and its Source line: "Shadowed by the repo".
  label: string;
  // The sentence, also the chip's title.
  words: string;
  // The link to the one that runs, and that one's origin (null: the repo's).
  link: string;
  origin: ISkillOrigin | null;
}

/**
 * What the CI list says besides its rows (CiStatusNote): asking, not set up, paused by
 * Bitbucket's rate limit, an error, no pipeline yet, or nothing.
 */
export type ICiNoteState =
  | "asking"
  | "setup"
  | "paused"
  | "error"
  | "empty"
  | "none";

/** A crumb of a page's title bar that leads back: its words and where it goes. */
export interface ICrumb {
  label: string;
  to: string;
  // A skill's name: in the code font.
  mono?: boolean;
}

export interface ISidebarNavItem {
  label: string;
  to: string;
  icon: Component;
  // What the row shows on its right (null: nothing).
  count: number | null;
  shown: boolean;
  // Whether the page at this path belongs to the item (its row then has the active fill).
  matches: (path: string) => boolean;
}

/** The Runs page's filter: every run, or the failed ones (`?show=failed`). */
export type IRunFilter = "all" | "failed";

// The theme the person picks; "system" follows the operating system (state/theme.ts).
export const THEME_CHOICES = ["system", "light", "dark"] as const;
export type IThemeChoice = (typeof THEME_CHOICES)[number];

/** The test a failure group lists: its latest attempt and the step it failed at. */
export interface IFailedTest {
  testId: string;
  title: string;
  suite: string;
  // The YAML file, or the spec for a test without one (the login setup).
  file: string;
  project: string;
  status: ITestStatus;
  ms: number | null;
  retry: number;
  // The deepest failed step (null: none failed, e.g. a setup without steps).
  step: { title: string; yaml: IYamlLocation | null } | null;
  // Where it failed: the step's place in the YAML, else the error's.
  yaml: IYamlLocation | null;
}

/** Failed tests of a run that failed the same way (lib/run-summary.ts). */
export interface IFailureGroup {
  // The first line of the error with its numbers, quoted text, ids and queries taken out, and the
  // element it names (its quoted text kept).
  key: string;
  // The first line as the first test of the group had it.
  cause: string;
  // The element the error names (a later line of it), as the first test had it; null: none.
  locator: string | null;
  // A setup (the login) failed this way: what made other tests not run.
  setup: boolean;
  tests: IFailedTest[];
}

/** One of a run's slowest tests, with its slowest YAML step. */
export interface ISlowTest {
  testId: string;
  title: string;
  status: ITestStatus;
  ms: number;
  step: { title: string; ms: number } | null;
}

/** One of a run's slowest YAML steps, with the test it belongs to. */
export interface ISlowStep {
  testId: string;
  stepId: string;
  title: string;
  ms: number;
  testTitle: string;
}

/** A test on a worker's line of the run's timeline: ms from the run's start. */
export interface ITimelineBar {
  testId: string;
  title: string;
  status: ITestStatus;
  tone: ITone;
  startMs: number;
  endMs: number;
}

/** One worker of the run and the tests it ran, in the order it ran them. */
export interface ITimelineLane {
  lane: number;
  bars: ITimelineBar[];
}

/** A run's headline numbers (counts as the progress bar has them). */
export interface ISummaryFigures {
  total: number;
  passed: number;
  failed: number;
  flaky: number;
  // Attempts beyond the first, over every test.
  retried: number;
  skipped: number;
  // null while it goes (the page counts it from its start).
  ms: number | null;
}

/** Tests that never ran because a setup they need failed. */
export interface ISetupMiss {
  count: number;
  setupTitles: string[];
}

/** A row of the Summary's slowest lists: a neutral bar, its length the share of the slowest. */
export interface ISlowRow {
  key: string;
  // The test the row opens: its own, or the one its step belongs to.
  testId: string;
  testTitle: string;
  title: string;
  // Faint after the title: a test's slowest step, a step's test.
  context: string | null;
  ms: number;
  // Percent of the slowest row's ms.
  share: number;
}
