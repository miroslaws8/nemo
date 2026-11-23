import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  SKILL_FILE,
  SKILL_SOURCE,
  SKILLS_DIRECTORY,
  withSchemaHeader,
} from "../../../engine/skills";
import type { ISkillChannel } from "../../../engine/types";
import type {
  ISkillPromotion,
  ISkillStoreKind,
  ISkillVersion,
} from "../../shared/types";
import { HttpError } from "../http-error";

// Where a skill added in the console goes, by the console's mode: a local console writes it into
// the working tree (hermes/skills/<name>/, which the developer commits); a server console keeps it
// in a store of its own on the data volume, not in git (<data dir>/skills/<name>/: meta.json and
// one folder per version, v<n>/skill.yaml, never changed once written) — or, given a bucket
// (QA_CONSOLE_SKILLS_*), in that bucket, the same folders mirrored on the data volume
// (skill-registry.ts), which a local console given the bucket reads too. A server console builds
// a stored skill's SKILL.md when it needs it, from the template of its own image. A stored skill
// has versions; prod runs the one an operator promoted (meta.json's prod), the other environments
// the newest (an environment's skill_channel).

/** A skill a store holds: its current skill.yaml, and the console's versions of it. */
export interface IStoredSkill {
  name: string;
  yaml: string;
  // What a new version says it replaces.
  hash: string;
  // The console's version (null: the working tree's, whose history is git's).
  version: number | null;
  versions: ISkillVersion[];
  // The version prod runs; null: none promoted yet (or the working tree's).
  prod: ISkillPromotion | null;
}

export interface ISkillStore {
  readonly kind: ISkillStoreKind;
  // Why this console may not add skills or give them versions here; null: it may.
  readonly readOnly: string | null;
  // Whether its skill wins over the repo's of the same name (else the repo's runs).
  readonly wins: boolean;
  /** The skills it holds apart from the run's commit: the console's (the working tree's are the repo's). */
  list(): IStoredSkill[];
  /** The skill a new version would replace, or null when it holds none of that name. */
  current(name: string): IStoredSkill | null;
  /** One version's skill.yaml (the console's), or null. */
  yamlOf(name: string, version: number): string | null;
  /** Adds a skill (409 when it has one of that name already). */
  add(
    name: string,
    yaml: string,
    skillMd: string,
    by: string | null
  ): Promise<void>;
  /** Gives a skill a new version (409 when it changed since `basedOn`). */
  replace(
    name: string,
    yaml: string,
    skillMd: string,
    basedOn: string,
    by: string | null
  ): Promise<void>;
  /** Makes one of a skill's versions the one prod runs. */
  promote(name: string, version: number, by: string | null): Promise<void>;
  /** Whether this console may delete the skill: one it keeps (a working tree's: not in git). */
  removable(name: string): boolean;
  /** Deletes a skill, every version of it. */
  remove(name: string): Promise<void>;
}

// The version of a stored skill each skill_channel runs: the newest, or the one promoted to prod.
const CHANNEL_VERSIONS: Record<
  ISkillChannel,
  (skill: Pick<IStoredSkill, "versions" | "prod">) => number | null
> = {
  latest: (skill) => skill.versions.at(-1)?.version ?? null,
  prod: (skill) => skill.prod?.version ?? null,
};

/** The version of a stored skill an environment's skill_channel runs; null: none on it. */
export function versionOn(
  channel: ISkillChannel,
  skill: Pick<IStoredSkill, "versions" | "prod">
): number | null {
  return CHANNEL_VERSIONS[channel](skill);
}

/** meta.json: a skill's versions, and the one promoted to prod. */
export function metaText(
  versions: ISkillVersion[],
  prod: ISkillPromotion | null
): string {
  return `${JSON.stringify({ versions, prod }, null, 2)}\n`;
}

export function hashOf(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/** The file as it is kept: one header line for the editor, no BOM, a final newline. */
export function asStored(yaml: string): string {
  const text = withSchemaHeader(yaml.replace(/^﻿/, ""));
  return text.endsWith("\n") ? text : `${text}\n`;
}

/** Writes a file whole or not at all: a temporary file beside it, then a rename. */
export function writeWhole(file: string, content: string, mode: number): void {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, content, { mode });
  fs.renameSync(temporary, file);
}

export function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

// Whether git keeps anything in a folder (it cannot tell without git: then it does, to be safe).
function isInGit(folder: string): boolean {
  try {
    return (
      execFileSync("git", ["ls-files", "--", folder], {
        cwd: path.dirname(folder),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() !== ""
    );
  } catch {
    return true;
  }
}

export function changedSince(name: string): HttpError {
  return new HttpError(
    409,
    `${name} has changed since you opened it: open it again and check your file against the new one`
  );
}

/** A local console: the skills are the working tree's, and an added one is a folder there. */
export class WorkingTreeSkills implements ISkillStore {
  readonly kind = "working-tree";
  readonly readOnly = null;
  readonly wins = false;

  list(): IStoredSkill[] {
    return [];
  }

  current(name: string): IStoredSkill | null {
    const yaml = readText(path.join(SKILLS_DIRECTORY, name, SKILL_SOURCE));
    return yaml === null
      ? null
      : {
          name,
          yaml,
          hash: hashOf(yaml),
          version: null,
          versions: [],
          prod: null,
        };
  }

  yamlOf(): string | null {
    return null;
  }

  async add(name: string, yaml: string, skillMd: string): Promise<void> {
    const folder = path.join(SKILLS_DIRECTORY, name);
    if (fs.existsSync(folder)) {
      throw new HttpError(
        409,
        `hermes/skills/${name} exists already: open it to replace it`
      );
    }
    fs.mkdirSync(folder, { recursive: true });
    this.write(folder, yaml, skillMd);
  }

  async replace(
    name: string,
    yaml: string,
    skillMd: string,
    basedOn: string
  ): Promise<void> {
    const now = this.current(name);
    if (now === null) {
      throw new HttpError(404, `hermes/skills/${name} has no skill.yaml`);
    }
    if (now.hash !== basedOn) {
      throw changedSince(name);
    }
    this.write(path.join(SKILLS_DIRECTORY, name), yaml, skillMd);
  }

  async promote(name: string): Promise<void> {
    throw new HttpError(
      409,
      `${name} is the repo's: its branch decides where it runs (develop on staging, main on prod)`
    );
  }

  // A folder git does not keep (one added here and not committed): git keeps the rest, and
  // takes them out with a commit.
  removable(name: string): boolean {
    return (
      fs.existsSync(path.join(SKILLS_DIRECTORY, name, SKILL_SOURCE)) &&
      !isInGit(path.join(SKILLS_DIRECTORY, name))
    );
  }

  async remove(name: string): Promise<void> {
    if (!this.removable(name)) {
      throw new HttpError(
        409,
        `hermes/skills/${name} is in git (or not here): delete it with a commit`
      );
    }
    fs.rmSync(path.join(SKILLS_DIRECTORY, name), { recursive: true });
  }

  private write(folder: string, yaml: string, skillMd: string): void {
    writeWhole(path.join(folder, SKILL_SOURCE), asStored(yaml), 0o644);
    writeWhole(path.join(folder, SKILL_FILE), skillMd, 0o644);
  }
}

const promotionSchema = z.object({
  version: z.number().int().positive(),
  by: z.string().nullable(),
  at: z.string(),
});

export const metaSchema = z.object({
  versions: z
    .array(
      z.object({
        version: z.number().int().positive(),
        by: z.string().nullable(),
        at: z.string(),
        hash: z.string(),
      })
    )
    .min(1),
  prod: promotionSchema.nullable().default(null),
});

/** A version promoted to prod: the one asked for, which the skill must have. */
export function promotion(
  skill: IStoredSkill,
  version: number,
  by: string | null
): ISkillPromotion {
  if (!skill.versions.some((known) => known.version === version)) {
    throw new HttpError(404, `${skill.name} has no version ${version}`);
  }
  return { version, by, at: new Date().toISOString() };
}

/** A server console: its own store on the data volume (or a bucket's mirror), the console's only. */
export class ConsoleSkills implements ISkillStore {
  readonly kind = "console";
  readonly readOnly = null;
  readonly wins = false;

  constructor(private readonly root: string) {
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    fs.chmodSync(this.root, 0o700);
  }

  list(): IStoredSkill[] {
    return fs
      .readdirSync(this.root)
      .sort()
      .flatMap((name) => {
        const skill = this.current(name);
        return skill === null ? [] : [skill];
      });
  }

  current(name: string): IStoredSkill | null {
    const meta = this.metaOf(name);
    const latest = meta?.versions.at(-1);
    if (meta === null || latest === undefined) {
      return null;
    }
    const yaml = this.yamlOf(name, latest.version);
    return yaml === null
      ? null
      : {
          name,
          yaml,
          hash: latest.hash,
          version: latest.version,
          versions: meta.versions,
          prod: meta.prod,
        };
  }

  yamlOf(name: string, version: number): string | null {
    return readText(path.join(this.root, name, `v${version}`, SKILL_SOURCE));
  }

  async add(
    name: string,
    yaml: string,
    _skillMd: string,
    by: string | null
  ): Promise<void> {
    if (fs.existsSync(path.join(this.root, name))) {
      throw new HttpError(
        409,
        `${name} is in this console already: open it to replace it`
      );
    }
    this.writeVersion(name, [], null, yaml, by);
  }

  async replace(
    name: string,
    yaml: string,
    _skillMd: string,
    basedOn: string,
    by: string | null
  ): Promise<void> {
    const now = this.current(name);
    if (now === null) {
      throw new HttpError(404, `${name} is not a skill of this console`);
    }
    if (now.hash !== basedOn) {
      throw changedSince(name);
    }
    this.writeVersion(name, now.versions, now.prod, yaml, by);
  }

  async promote(
    name: string,
    version: number,
    by: string | null
  ): Promise<void> {
    const now = this.current(name);
    if (now === null) {
      throw new HttpError(404, `${name} is not a skill of this console`);
    }
    writeWhole(
      path.join(this.root, name, "meta.json"),
      metaText(now.versions, promotion(now, version, by)),
      0o600
    );
  }

  removable(name: string): boolean {
    return this.current(name) !== null;
  }

  async remove(name: string): Promise<void> {
    if (!this.removable(name)) {
      throw new HttpError(404, `${name} is not a skill of this console`);
    }
    fs.rmSync(path.join(this.root, name), { recursive: true });
  }

  private metaOf(name: string): {
    versions: ISkillVersion[];
    prod: ISkillPromotion | null;
  } | null {
    const text = readText(path.join(this.root, name, "meta.json"));
    if (text === null) {
      return null;
    }
    try {
      const parsed = metaSchema.safeParse(JSON.parse(text));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  // The new version's file first, then meta.json naming it: a crash in between leaves the
  // previous version current.
  private writeVersion(
    name: string,
    earlier: ISkillVersion[],
    prod: ISkillPromotion | null,
    yaml: string,
    by: string | null
  ): void {
    const stored = asStored(yaml);
    const version = (earlier.at(-1)?.version ?? 0) + 1;
    const folder = path.join(this.root, name, `v${version}`);
    fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
    writeWhole(path.join(folder, SKILL_SOURCE), stored, 0o600);
    const versions: ISkillVersion[] = [
      ...earlier,
      { version, by, at: new Date().toISOString(), hash: hashOf(stored) },
    ];
    writeWhole(
      path.join(this.root, name, "meta.json"),
      metaText(versions, prod),
      0o600
    );
  }
}
