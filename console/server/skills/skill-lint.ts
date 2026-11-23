import { TEMPLATE_PLACEHOLDER } from "../../../engine/skill-schema";
import type { ISkillFile, IYamlDocument } from "../../../engine/types";
import { readYamlSource } from "../../../engine/yaml-document";
import type { ISkillProblem, ISkillStoreKind } from "../../shared/types";
import { unavailableReason } from "./skill-reader";

// What the console checks in a skill.yaml beyond its fields, before it takes one: what would make
// a check go wrong in the console, or put something in a skill that does not belong there. These
// are heuristics, not the security boundary (that is the operator role and the audit log).

export interface ILintInput {
  // The skill.yaml as sent, and the skill and SKILL.md it makes (null while it has errors).
  text: string;
  skill: ISkillFile | null;
  skillMd: string | null;
  // Where it goes: a store runs only what it can (it keeps nothing else); the working tree may.
  store: ISkillStoreKind;
}

const SECRETS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{8,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  // A password with a value; not a placeholder (<…>, ${…}, `…`) or a variable's name.
  /\b(?:password|passwd|pwd)\s*[:=]\s*(?![<$`'"]|QA_)[^\s,;)]{4,}/i,
];
const EMAIL =
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g;
// Addresses that are no one's.
const EXAMPLE_EMAIL =
  /@(?:example\.(?:com|org|net)|[a-z0-9.-]*\.(?:test|invalid|example))$/i;
const PERSONAL_PATH = /(?:\/Users|\/home)\/[A-Za-z0-9._-]+/;

function positionAt(
  text: string,
  index: number
): { line: number; column: number } {
  const before = text.slice(0, index).split("\n");
  return { line: before.length, column: (before.at(-1)?.length ?? 0) + 1 };
}

function found(
  severity: ISkillProblem["severity"],
  message: string,
  text: string,
  index: number | null,
  path: ISkillProblem["path"] = [],
  document: IYamlDocument | null = null
): ISkillProblem {
  const at = index === null ? null : positionAt(text, index);
  return {
    severity,
    message,
    // The field the place is in, so that a form can show it there.
    path:
      path.length === 0 && at !== null && document !== null
        ? document.pathAt(at.line, at.column)
        : path,
    line: at?.line ?? null,
    column: at?.column ?? null,
  };
}

function lineOfKey(text: string, key: string): number | null {
  const match = new RegExp(`^${key}:`, "m").exec(text);
  return match === null ? null : match.index;
}

/** The problems beyond the fields: errors stop the skill from being added, warnings do not. */
export function lintSkill(input: ILintInput): ISkillProblem[] {
  const { text, skill, skillMd, store } = input;
  const problems: ISkillProblem[] = [];
  const document = readYamlSource(text.replace(/^\uFEFF/, "")).document;

  // Every place a template left for the author's words, until each is filled in.
  const placeholders = new RegExp(TEMPLATE_PLACEHOLDER.source, "g");
  for (const match of text.matchAll(placeholders)) {
    problems.push(
      found(
        "error",
        `Fill in ${match[0].replace(
          /\s+/g,
          " "
        )}: a place the template left for your words`,
        text,
        match.index ?? null,
        [],
        document
      )
    );
  }

  for (const pattern of SECRETS) {
    const match = pattern.exec(text);
    if (match !== null) {
      problems.push(
        found(
          "error",
          "This looks like a secret (an API key, a private key or a password): a skill never carries one — the QA account's password comes from the vault",
          text,
          match.index,
          [],
          document
        )
      );
    }
  }
  for (const match of text.matchAll(EMAIL)) {
    if (!EXAMPLE_EMAIL.test(match[0])) {
      problems.push(
        found(
          "warning",
          `${match[0]}: keep personal data out of skills (the QA account's email comes from the environment)`,
          text,
          match.index ?? null,
          [],
          document
        )
      );
      break;
    }
  }
  const home = PERSONAL_PATH.exec(text);
  if (home !== null) {
    problems.push(
      found(
        "warning",
        `${home[0]}: a path in someone's home — write ~/… (each check has a HOME of its own)`,
        text,
        home.index,
        [],
        document
      )
    );
  }

  if (skill === null || skillMd === null) {
    return problems;
  }
  const unavailable = unavailableReason(skillMd, []);
  if (unavailable !== null) {
    problems.push(
      found(
        store === "working-tree" ? "warning" : "error",
        store === "working-tree"
          ? `The console will not offer it: it ${unavailable}`
          : `The console cannot run it: it ${unavailable}. A skill like this belongs in the repo`,
        text,
        null
      )
    );
  }
  if (skill.safety === "creates_data" && !text.includes("QA_DATA_PREFIX")) {
    problems.push(
      found(
        unavailable === null ? "error" : "warning",
        "It creates data but never says QA_DATA_PREFIX: start the title of what it creates with it (shared contract → Titles of what you create), or Clean up cannot find it",
        text,
        lineOfKey(text, "safety"),
        ["safety"]
      )
    );
  }
  if (skill.screenshots === undefined && unavailable === null) {
    problems.push(
      found(
        "warning",
        "No screenshots: the check's page will have none to show",
        text,
        null,
        ["screenshots"]
      )
    );
  }
  return problems;
}
