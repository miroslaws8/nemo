import { DEFAULT_ENVIRONMENT } from "../../../engine/environment";
import {
  parseSkillSource,
  parseSkillTemplate,
  SKILL_TEMPLATES_FOLDER,
  skillFields,
  skillTemplateId,
} from "../../../engine/skills";
import type { ISkillFile } from "../../../engine/types";
import type {
  IRunRecord,
  IRunSource,
  ISkillDetail,
  ISkillExample,
  ISkillTemplateList,
  ISkillList,
  ISkillOrigin,
  ISkillPromotion,
  ISkillSummary,
  ISkillVersion,
} from "../../shared/types";
import type { AgentRuns } from "../agents/agent-runs";
import { offeredEnvironments } from "../environments";
import { HttpError } from "../http-error";
import { listRuns } from "../run-store";
import type { IWorkspace } from "../types";
import {
  descriptionOf,
  type IRepoSkill,
  readRepoSkills,
  skillTemplate,
  unavailableReason,
} from "./skill-reader";
import { hashOf, type ISkillStore, type IStoredSkill } from "./skill-stores";

// What the Skills page shows: the repo's skills (hermes/skills of a branch: the default
// environment's unless one is asked for) and the store's (added in a server console, or in the
// skill store) — each with what it changes, whether the console runs it, where CI runs it, the
// version prod runs and how its last check went.

// The skill a new one is best started from (GET /api/skills/example): the smallest.
const EXAMPLE_SKILL = "qa-landing-mobile";

interface ISkillEntry {
  summary: ISkillSummary;
  yaml: string | null;
  skillMd: string | null;
  fields: ISkillFile | null;
  hash: string | null;
  versions: ISkillVersion[];
  prod: ISkillPromotion | null;
}

function firstError(problems: { severity: string; message: string }[]) {
  return problems.find((found) => found.severity === "error")?.message ?? null;
}

function lastRunOf(
  runs: IRunRecord[],
  name: string,
  origin: ISkillOrigin
): ISkillSummary["lastRun"] {
  const run = runs.find(
    (record) =>
      record.agent?.skill === name && record.agent.skillOrigin === origin
  );
  return run === undefined
    ? null
    : {
        id: run.id,
        status: run.status,
        endedAt: run.endedAt,
        usd: run.agent?.usage?.estimatedUsd ?? null,
      };
}

export class SkillCatalog {
  constructor(
    private readonly workspace: IWorkspace,
    private readonly store: ISkillStore,
    private readonly agents: AgentRuns
  ) {}

  async list(ref: string | null): Promise<ISkillList> {
    const source = await this.sourceOf(ref);
    return {
      source,
      store: this.store.kind,
      skills: (await this.entries(source)).map((entry) => entry.summary),
    };
  }

  /** One skill: the one that runs (the repo's when both have the name), or the `origin` asked for. */
  async detail(
    name: string,
    ref: string | null,
    origin: ISkillOrigin | null
  ): Promise<ISkillDetail> {
    const entry = this.pick(
      await this.entries(await this.sourceOf(ref)),
      name,
      origin
    );
    return {
      skill: entry.summary,
      yaml: entry.yaml,
      skillMd: entry.skillMd,
      fields: entry.fields,
      hash: entry.hash,
      versions: entry.versions,
      prod: entry.prod,
      // The store's skill, or (a working copy) a repo one git does not keep.
      deletable:
        (entry.summary.origin === "console" ||
          this.store.kind === "working-tree") &&
        this.store.removable(name),
    };
  }

  /** A skill's skill.yaml to download: the current one, or a version of a console skill. */
  async yamlFile(
    name: string,
    ref: string | null,
    origin: ISkillOrigin | null,
    version: number | null
  ): Promise<string> {
    if (version !== null) {
      const yaml = this.store.yamlOf(name, version);
      if (yaml === null) {
        throw new HttpError(404, `${name} has no version ${version} here`);
      }
      return yaml;
    }
    const detail = await this.detail(name, ref, origin);
    if (detail.yaml === null) {
      throw new HttpError(404, `${name} has no skill.yaml on this branch`);
    }
    return detail.yaml;
  }

  // The one that runs: the skill store's once the skill has left git.
  async example(): Promise<ISkillExample> {
    const yaml = (await this.entries(await this.sourceOf(null))).find(
      (entry) => entry.summary.name === EXAMPLE_SKILL && !entry.summary.shadowed
    )?.yaml;
    if (yaml === undefined || yaml === null) {
      throw new HttpError(404, `${EXAMPLE_SKILL} has no skill.yaml here`);
    }
    return { name: EXAMPLE_SKILL, yaml, fields: skillFields() };
  }

  /** The skill templates of the default environment's branch (or the working tree); a broken one is left out. */
  async templates(): Promise<ISkillTemplateList> {
    const source = await this.sourceOf(null);
    const files = await this.workspace.listFolder(
      source,
      SKILL_TEMPLATES_FOLDER
    );
    const template = skillTemplate();
    const templates: ISkillTemplateList["templates"] = [];
    for (const fileName of [...files].sort()) {
      const id = skillTemplateId(fileName);
      const text =
        id === null
          ? null
          : await this.workspace.readFile(
              source,
              `${SKILL_TEMPLATES_FOLDER}/${fileName}`
            );
      if (id === null || text === null) {
        continue;
      }
      const read = parseSkillTemplate(fileName, text, template);
      if (read.template !== null) {
        templates.push({
          id,
          label: read.template.label,
          about: read.template.about,
          fields: read.template.skill,
        });
      }
    }
    return { templates };
  }

  /** The names of the repo's skills on every environment's own branch (one it can read), with that branch. */
  async repoNames(): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    for (const environment of offeredEnvironments()) {
      let source: IRunSource;
      try {
        source = await this.workspace.resolve(environment.name, null, null);
      } catch {
        continue;
      }
      for (const skill of (await readRepoSkills(this.workspace, source)) ??
        []) {
        if (!names.has(skill.name)) {
          names.set(skill.name, source.ref ?? "the working tree");
        }
      }
    }
    return names;
  }

  private sourceOf(ref: string | null): Promise<IRunSource> {
    return this.workspace.resolve(DEFAULT_ENVIRONMENT, null, ref);
  }

  private pick(
    entries: ISkillEntry[],
    name: string,
    origin: ISkillOrigin | null
  ): ISkillEntry {
    const named = entries.filter((entry) => entry.summary.name === name);
    const entry =
      origin === null
        ? named.find((found) => !found.summary.shadowed) ?? named[0]
        : named.find((found) => found.summary.origin === origin);
    if (entry === undefined) {
      throw new HttpError(404, `${name} is not a skill here`);
    }
    return entry;
  }

  private async entries(source: IRunSource): Promise<ISkillEntry[]> {
    const template = skillTemplate();
    const repo = (await readRepoSkills(this.workspace, source)) ?? [];
    const stored = this.store.list();
    const repoNames = new Set(repo.map((skill) => skill.name));
    const storedNames = new Set(stored.map((skill) => skill.name));
    const afterDeploys = await this.afterDeploys();
    const runs = listRuns();
    // Of two skills with one name, the store's runs when it wins (the skill store), else the repo's.
    return [
      ...repo.map((skill) =>
        this.repoEntry(
          skill,
          template,
          this.store.wins && storedNames.has(skill.name),
          afterDeploys,
          runs
        )
      ),
      ...stored.map((skill) =>
        this.consoleEntry(
          skill,
          template,
          !this.store.wins && repoNames.has(skill.name),
          afterDeploys,
          runs
        )
      ),
    ].sort((left, right) =>
      left.summary.name === right.summary.name
        ? Number(left.summary.shadowed) - Number(right.summary.shadowed)
        : left.summary.name.localeCompare(right.summary.name)
    );
  }

  private repoEntry(
    skill: IRepoSkill,
    template: string,
    shadowed: boolean,
    afterDeploys: Map<string, string[]>,
    runs: IRunRecord[]
  ): ISkillEntry {
    const read =
      skill.yaml === null
        ? null
        : parseSkillSource(skill.name, skill.yaml, template);
    const fields = read?.skill ?? null;
    return {
      summary: {
        name: skill.name,
        origin: "repo",
        version: null,
        title: fields?.title ?? null,
        description: fields?.description ?? descriptionOf(skill.skillMd),
        safety: fields?.safety ?? null,
        aiCredits: fields?.ai_credits ?? false,
        startAt: fields?.start_at ?? null,
        unavailable: unavailableReason(skill.skillMd, skill.files),
        shadowed,
        problem: read === null ? null : firstError(read.problems),
        afterDeploys: afterDeploys.get(skill.name) ?? [],
        lastRun: lastRunOf(runs, skill.name, "repo"),
        updatedBy: null,
        updatedAt: null,
        prodVersion: null,
      },
      yaml: skill.yaml,
      skillMd: skill.skillMd,
      fields,
      // Only the working tree's repo skills take a new version here.
      hash:
        this.store.kind === "working-tree" && skill.yaml !== null
          ? hashOf(skill.yaml)
          : null,
      versions: [],
      prod: null,
    };
  }

  private consoleEntry(
    stored: IStoredSkill,
    template: string,
    shadowed: boolean,
    afterDeploys: Map<string, string[]>,
    runs: IRunRecord[]
  ): ISkillEntry {
    const read = parseSkillSource(stored.name, stored.yaml, template);
    const fields = read.skill;
    const latest = stored.versions.at(-1);
    return {
      summary: {
        name: stored.name,
        origin: "console",
        version: stored.version,
        title: fields?.title ?? null,
        description: fields?.description ?? "",
        safety: fields?.safety ?? null,
        aiCredits: fields?.ai_credits ?? false,
        startAt: fields?.start_at ?? null,
        unavailable:
          read.skillMd === null
            ? "no longer reads as a skill: give it a new version"
            : unavailableReason(read.skillMd, []),
        shadowed,
        problem: firstError(read.problems),
        afterDeploys: afterDeploys.get(stored.name) ?? [],
        lastRun: lastRunOf(runs, stored.name, "console"),
        updatedBy: latest?.by ?? null,
        updatedAt: latest?.at ?? null,
        prodVersion: stored.prod?.version ?? null,
      },
      yaml: stored.yaml,
      skillMd: read.skillMd,
      fields,
      hash: stored.hash,
      versions: stored.versions,
      prod: stored.prod,
    };
  }

  // Skill name → the environments whose agent_checks list it (each on its own branch).
  private async afterDeploys(): Promise<Map<string, string[]>> {
    const lists = new Map<string, string[]>();
    for (const environment of offeredEnvironments()) {
      let names: string[];
      try {
        const source = await this.workspace.resolve(
          environment.name,
          null,
          null
        );
        names = await this.agents.listedChecks(environment.name, source);
      } catch {
        continue;
      }
      for (const name of names) {
        lists.set(name, [...(lists.get(name) ?? []), environment.name]);
      }
    }
    return lists;
  }
}
