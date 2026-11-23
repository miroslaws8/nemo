import { parseSkillSource, SKILL_SOURCE } from "../../../engine/skills";
import {
  SKILL_MAX_BYTES,
  skillNameProblem,
} from "../../../engine/skill-schema";
import type { ISkillFile } from "../../../engine/types";
import type {
  IAddSkillRequest,
  IReplaceSkillRequest,
  ISkillCheck,
  ISkillCheckRequest,
  ISkillDetail,
  ISkillProblem,
  ISkillStoreKind,
} from "../../shared/types";
import { HttpError } from "../http-error";
import { AGENT_SKILLS_DIR } from "../settings";
import type { SkillCatalog } from "./skill-catalog";
import { lintSkill } from "./skill-lint";
import { skillTemplate } from "./skill-reader";
import { asStored, type ISkillStore, type IStoredSkill } from "./skill-stores";
import { lineDiff } from "./text-diff";

// Where a store keeps the skills added to it, in words.
const STORE_PLACES: Record<ISkillStoreKind, string> = {
  "working-tree": "this working copy",
  console: "this console",
  registry: "the skill store",
};

// A skill.yaml checked as the console would take it (its fields, what it would do in the console,
// whether its name is free or it replaces one this console may replace), then added or given a new
// version. Every step after a person's upload is the console's: nothing is left to run by hand.

type IUse = "add" | "replace";

interface IExamined {
  problems: ISkillProblem[];
  skill: ISkillFile | null;
  skillMd: string | null;
  current: IStoredSkill | null;
}

function fileProblem(message: string): ISkillProblem {
  return { severity: "error", message, path: [], line: null, column: null };
}

function byPlace(left: ISkillProblem, right: ISkillProblem): number {
  return (
    (left.line ?? Number.MAX_SAFE_INTEGER) -
      (right.line ?? Number.MAX_SAFE_INTEGER) ||
    (left.column ?? 0) - (right.column ?? 0)
  );
}

export class SkillChecks {
  constructor(
    private readonly store: ISkillStore,
    private readonly catalog: SkillCatalog
  ) {}

  async check(request: ISkillCheckRequest): Promise<ISkillCheck> {
    // A skill being written may have no name yet: the rest is checked, adding still needs one.
    const examined = await this.examine(
      request.name === "" ? null : request.name,
      request.yaml,
      request.replacing ? "replace" : "add"
    );
    return {
      problems: examined.problems,
      preview:
        examined.skill === null || examined.skillMd === null
          ? null
          : { skillMd: examined.skillMd, fields: examined.skill },
      diff:
        examined.current === null
          ? null
          : // Against the file as it would be kept (the header line the console adds).
            lineDiff(examined.current.yaml, asStored(request.yaml)),
    };
  }

  async add(
    request: IAddSkillRequest,
    by: string | null
  ): Promise<ISkillDetail> {
    const examined = await this.examine(request.name, request.yaml, "add");
    await this.store.add(
      request.name,
      request.yaml,
      this.requireTakeable(examined),
      by
    );
    return this.catalog.detail(request.name, null, this.origin());
  }

  /** Deletes a skill from where this console keeps them. */
  async remove(name: string): Promise<{ deleted: string }> {
    await this.store.remove(name);
    return { deleted: name };
  }

  /** Makes one of a stored skill's versions the one prod runs. */
  async promote(
    name: string,
    version: number,
    by: string | null
  ): Promise<ISkillDetail> {
    await this.store.promote(name, version, by);
    return this.catalog.detail(name, null, "console");
  }

  async replace(
    name: string,
    request: IReplaceSkillRequest,
    by: string | null
  ): Promise<ISkillDetail> {
    const examined = await this.examine(name, request.yaml, "replace");
    await this.store.replace(
      name,
      request.yaml,
      this.requireTakeable(examined),
      request.basedOn,
      by
    );
    return this.catalog.detail(name, null, this.origin());
  }

  private origin(): "repo" | "console" {
    return this.store.kind === "working-tree" ? "repo" : "console";
  }

  // Its SKILL.md once nothing stops it; else 409 with the first error (the page shows them all).
  private requireTakeable(examined: IExamined): string {
    const errors = examined.problems.filter(
      (found) => found.severity === "error"
    );
    if (errors.length > 0 || examined.skillMd === null) {
      throw new HttpError(
        409,
        `${errors.length} problem${
          errors.length === 1 ? "" : "s"
        } to fix first: ${errors[0]?.message ?? "the skill does not read"}`
      );
    }
    return examined.skillMd;
  }

  private async examine(
    name: string | null,
    yaml: string,
    use: IUse
  ): Promise<IExamined> {
    if (Buffer.byteLength(yaml) > SKILL_MAX_BYTES) {
      return {
        problems: [
          fileProblem(
            `The file is larger than ${
              SKILL_MAX_BYTES / 1024
            } KB: a skill.yaml is a few KB`
          ),
        ],
        skill: null,
        skillMd: null,
        current: null,
      };
    }
    const read = parseSkillSource(name, yaml, skillTemplate());
    const current =
      use === "replace" && name !== null ? this.store.current(name) : null;
    const problems = [
      ...read.problems,
      ...lintSkill({
        text: yaml,
        skill: read.skill,
        skillMd: read.skillMd,
        store: this.store.kind,
      }),
      ...(name !== null && skillNameProblem(name) === null
        ? await this.nameProblems(name, use, current)
        : []),
    ].sort(byPlace);
    return { problems, skill: read.skill, skillMd: read.skillMd, current };
  }

  private async nameProblems(
    name: string,
    use: IUse,
    current: IStoredSkill | null
  ): Promise<ISkillProblem[]> {
    const repo = await this.catalog.repoNames();
    if (use === "replace") {
      if (current !== null) {
        return [];
      }
      const branch = repo.get(name);
      return [
        fileProblem(
          branch === undefined
            ? `There is no skill ${name} here to replace`
            : this.store.kind === "working-tree"
            ? `${AGENT_SKILLS_DIR}/${name} has no ${SKILL_SOURCE} to replace`
            : `${name} lives in the repo (${branch}): change ${AGENT_SKILLS_DIR}/${name}/${SKILL_SOURCE} there`
        ),
      ];
    }
    if (this.store.current(name) !== null) {
      return [
        fileProblem(
          this.store.kind === "working-tree"
            ? `${AGENT_SKILLS_DIR}/${name} exists already: open it to give it a new version`
            : `${name} is in ${
                STORE_PLACES[this.store.kind]
              } already: open it to give it a new version`
        ),
      ];
    }
    const branch = repo.get(name);
    return branch === undefined
      ? []
      : [
          fileProblem(
            this.store.kind === "working-tree"
              ? `${AGENT_SKILLS_DIR}/${name} exists already: open it to give it a new version`
              : `${name} is a skill of the repo (${branch}): pick another name`
          ),
        ];
  }
}
