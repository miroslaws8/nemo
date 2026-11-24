import type {
  ISkillDetail,
  ISkillSafety,
  INoticeSummary,
  IRetryScope,
  IRunCounts,
  ISignInProblem,
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
  variant: "default" | "destructive";
  // Literal Tailwind classes of its tone.
  classes: string;
  // What happened and what to do, for a run still going or one that is over.
  lines: (notice: INoticeSummary, going: boolean) => string[];
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
}

/** Whether the signed-in person may do something, and if not, why (shown by the button). */
export interface IPermission {
  allowed: boolean;
  reason: string | null;
}

/** The words that change with where tests run: this Mac, or the console's server. */
export interface IModeWords {
  runsTab: string;
  runsNav: string;
  newRun: string;
  home: string;
}

/** What a console's skill store means for its Skills pages (by where it keeps skills). */
export interface IStoreWords {
  // Where the Skills page's skills come from.
  skills: string;
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

/** A place the sidebar leads to: Runs, CI, Skills. */
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
