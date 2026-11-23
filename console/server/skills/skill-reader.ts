import fs from "node:fs";
import { parse } from "yaml";
import { z } from "zod";
import { SKILL_TEMPLATE_PATH } from "../../../engine/skills";
import type { IRunSource } from "../../shared/types";
import { AGENT_SHARED_CONTRACT, AGENT_SKILLS_DIR } from "../settings";
import type { IWorkspace } from "../types";

// Reading skills: the repo's (hermes/skills of a commit, through the workspace) and what the
// console can tell of any skill (why it cannot run one; its description from SKILL.md).

/** A skill of a commit: its SKILL.md, the names in its folder and its skill.yaml (null: none). */
export interface IRepoSkill {
  name: string;
  skillMd: string;
  files: string[];
  yaml: string | null;
}

/** Whether a skill runs Playwright scripts, its own (a scripts folder) or another skill's. */
export function runsScripts(skillMd: string, files: string[]): boolean {
  return (
    files.includes("scripts") || /skills\/[a-z0-9-]+\/scripts\//.test(skillMd)
  );
}

// Why the console cannot run a skill yet (the first that applies), by what the skill needs:
// Playwright scripts of its own or another skill's (their packages and the QA account's
// password).
const NOT_YET: {
  applies: (skillMd: string, files: string[]) => boolean;
  reason: string;
}[] = [
  {
    applies: runsScripts,
    reason: "needs Playwright scripts that the console does not run yet",
  },
];

/** Why the console cannot run a skill (by its SKILL.md and folder), or null when it can. */
export function unavailableReason(
  skillMd: string,
  files: string[]
): string | null {
  return NOT_YET.find((rule) => rule.applies(skillMd, files))?.reason ?? null;
}

const frontMatterSchema = z.object({
  description: z.string().default(""),
});

/** The description in a SKILL.md's front matter ("" when it has none). */
export function descriptionOf(skillMd: string): string {
  const match = /^---\n([\s\S]*?)\n---/.exec(skillMd);
  const parsed = frontMatterSchema.safeParse(
    match?.[1] === undefined ? {} : parse(match[1])
  );
  return parsed.success ? parsed.data.description : "";
}

/** The Markdown base every skill's SKILL.md is filled into: the console's own copy. */
export function skillTemplate(): string {
  return fs.readFileSync(SKILL_TEMPLATE_PATH, "utf8");
}

/** The skills of a commit; null when it has no shared contract (hermes/qa-shared.md) to run them by. */
export async function readRepoSkills(
  workspace: IWorkspace,
  source: IRunSource
): Promise<IRepoSkill[] | null> {
  if ((await workspace.readFile(source, AGENT_SHARED_CONTRACT)) === null) {
    return null;
  }
  const names = await workspace.listFolder(source, AGENT_SKILLS_DIR);
  const skills = await Promise.all(
    names.map(async (name): Promise<IRepoSkill[]> => {
      const folder = `${AGENT_SKILLS_DIR}/${name}`;
      const skillMd = await workspace.readFile(source, `${folder}/SKILL.md`);
      if (skillMd === null) {
        return [];
      }
      return [
        {
          name,
          skillMd,
          files: await workspace.listFolder(source, folder),
          yaml: await workspace.readFile(source, `${folder}/skill.yaml`),
        },
      ];
    })
  );
  return skills.flat();
}
