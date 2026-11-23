import { SKILL_NAME_PATTERN } from "@shared/api";
import type {
  IRunSource,
  ISkillOrigin,
  ISkillSafety,
  ISkillStoreKind,
  ISkillSummary,
} from "@shared/types";
import type { ITone } from "@/types";

// How the Skills pages word a skill: what it changes, where it comes from.

export const SAFETY_WORDS: Record<
  ISkillSafety,
  { label: string; tone: ITone; hint: string }
> = {
  read_only: {
    label: "Read-only",
    tone: "idle",
    hint: "Changes nothing but logging in, on every environment.",
  },
  records_activity: {
    label: "Records activity",
    tone: "idle",
    hint: "Leaves the test account's own progress or attempts behind.",
  },
  creates_data: {
    label: "Creates data",
    tone: "flaky",
    hint: "Creates records, titled so that Clean up finds them.",
  },
};

/** What is wrong with a new skill's name as typed, or null (the console checks it too). */
export function skillNameHint(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === "") {
    return "Give it a name: the folder it goes in, e.g. qa-landing-mobile.";
  }
  return SKILL_NAME_PATTERN.test(trimmed)
    ? null
    : "A name starts with qa- and goes on in lowercase letters, digits and single hyphens.";
}

// Where a console keeps the skills added in it, in words (a stored skill's origin is "console").
export const STORE_WORDS: Record<
  ISkillStoreKind,
  { origin: string; chip: string; place: string }
> = {
  "working-tree": {
    origin: "Added in this working copy",
    chip: "Working copy",
    place: "this working copy",
  },
  console: {
    origin: "Added in this console",
    chip: "Console",
    place: "this console",
  },
  registry: {
    origin: "In the skill store",
    chip: "Store",
    place: "the skill store",
  },
};

/** Where a skill comes from, in a few words. */
export function originWords(
  skill: Pick<ISkillSummary, "origin" | "version">,
  store: ISkillStoreKind
): string {
  return skill.origin === "console"
    ? `${STORE_WORDS[store].origin} · v${skill.version ?? "?"}`
    : "From the repo";
}

/** The commit the repo's skills come from: "develop at 1a2b3c4", or the working copy. */
export function sourceWords(source: IRunSource): string {
  return source.ref === null || source.sha === null
    ? "this working copy"
    : `${source.ref} at ${source.sha.slice(0, 7)}`;
}

/** The skill a link should open: the console's copy only when the repo's one shadows it. */
export function linkOrigin(skill: ISkillSummary): ISkillOrigin | null {
  return skill.origin === "console" && skill.shadowed ? "console" : null;
}
