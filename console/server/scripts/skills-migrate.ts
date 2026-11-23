import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  parseSkillSource,
  SKILL_FILE,
  SKILL_SOURCE,
  SKILLS_DIRECTORY,
} from "../../../engine/skills";
import { E2E_ROOT } from "../../../engine/paths";
import { consoleSettings } from "../config";
import { CONSOLE_SKILLS_DIR } from "../settings";
import { runsScripts, skillTemplate } from "../skills/skill-reader";
import {
  type IVersionToWrite,
  registryFolder,
  SkillBucket,
  storedMetas,
  writeSkill,
} from "../skills/skill-registry";
import { ConsoleSkills } from "../skills/skill-stores";

// pnpm skills:migrate [--dry-run]: puts into the skill store (QA_CONSOLE_SKILLS_*, with a key
// that may write) the skills that leave git — every hermes/skills folder of this checkout that is
// a skill.yaml and its SKILL.md and runs no Playwright scripts — as version 1, promoted to prod so
// prod keeps running them; and, run on a server console, the skills of its own store
// (<data dir>/skills) with all their versions, prod on the newest (they ran everywhere). A skill
// the store has already is left alone, so it may run again. Run it before the commit that deletes
// those folders from git reaches develop and main (docs/guide.md → Skills).

interface ICandidate {
  name: string;
  from: string;
  versions: IVersionToWrite[];
  prodVersion: number | null;
}

interface IOutcome {
  name: string;
  from: string;
  outcome: string;
}

const MOVES_WITH = new Set([SKILL_SOURCE, SKILL_FILE]);

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

// The checkout's commit, or (an image, which has no .git) the console's build.
function checkoutName(build: string): string {
  try {
    const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: E2E_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return `git ${sha}`;
  } catch {
    return `build ${build}`;
  }
}

// The checkout's skills: the ones that move, and why the others stay.
function repoCandidates(
  at: string,
  checkout: string
): {
  moving: ICandidate[];
  staying: IOutcome[];
} {
  const moving: ICandidate[] = [];
  const staying: IOutcome[] = [];
  const from = `hermes/skills (${checkout})`;
  for (const name of fs.readdirSync(SKILLS_DIRECTORY).sort()) {
    const folder = path.join(SKILLS_DIRECTORY, name);
    if (!fs.statSync(folder).isDirectory()) {
      continue;
    }
    const files = fs.readdirSync(folder);
    const yaml = readText(path.join(folder, SKILL_SOURCE));
    const skillMd = readText(path.join(folder, SKILL_FILE)) ?? "";
    if (yaml === null) {
      staying.push({
        name,
        from,
        outcome: `stays in git: it has no ${SKILL_SOURCE}`,
      });
    } else if (
      runsScripts(skillMd, files) ||
      files.some((file) => !MOVES_WITH.has(file))
    ) {
      staying.push({
        name,
        from,
        outcome: "stays in git: it runs Playwright scripts",
      });
    } else {
      moving.push({
        name,
        from,
        versions: [{ yaml, by: from, at }],
        prodVersion: 1,
      });
    }
  }
  return { moving, staying };
}

// A server console's own store, every version as it was added.
function consoleCandidates(dataDir: string): ICandidate[] {
  const root = path.join(dataDir, CONSOLE_SKILLS_DIR);
  if (!fs.existsSync(root)) {
    return [];
  }
  const store = new ConsoleSkills(root);
  return store.list().map((skill) => ({
    name: skill.name,
    from: "this console's store",
    versions: skill.versions.map((version) => ({
      yaml: store.yamlOf(skill.name, version.version) ?? "",
      by: version.by,
      at: version.at,
    })),
    prodVersion: skill.prod?.version ?? skill.version,
  }));
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const settings = consoleSettings();
  const registry = settings.skillRegistry;
  if (registry === null) {
    throw new Error(
      "No skill store here: set QA_CONSOLE_SKILLS_BUCKET and its key (docs/guide.md → Skills)"
    );
  }
  const bucket = new SkillBucket(registry);
  const folder = registryFolder(registry);
  const inStore = await storedMetas(bucket, folder);
  const template = skillTemplate();
  const { moving, staying } = repoCandidates(
    new Date().toISOString(),
    checkoutName(settings.build)
  );
  const repoNames = new Set(moving.map((candidate) => candidate.name));
  const outcomes: IOutcome[] = [...staying];
  for (const candidate of [...moving, ...consoleCandidates(settings.dataDir)]) {
    const latest = candidate.versions.at(-1)?.yaml ?? "";
    const problem = parseSkillSource(
      candidate.name,
      latest,
      template
    ).problems.find((found) => found.severity === "error");
    const outcome =
      candidate.from === "this console's store" && repoNames.has(candidate.name)
        ? "left: the repo has a skill of this name, and that one ran"
        : inStore.has(candidate.name)
        ? "left: the skill store has it already"
        : problem !== undefined
        ? `left: its skill.yaml does not read (${problem.message})`
        : null;
    if (outcome !== null) {
      outcomes.push({ name: candidate.name, from: candidate.from, outcome });
      continue;
    }
    if (!dryRun) {
      await writeSkill(
        bucket,
        folder,
        candidate.name,
        candidate.versions,
        candidate.prodVersion
      );
    }
    outcomes.push({
      name: candidate.name,
      from: candidate.from,
      outcome: `${dryRun ? "would move" : "moved"}: ${
        candidate.versions.length
      } version${candidate.versions.length === 1 ? "" : "s"}, prod on v${
        candidate.prodVersion ?? "?"
      }`,
    });
  }
  console.log(
    `${dryRun ? "Dry run: nothing written. " : ""}Skill store: bucket ${
      registry.bucket
    }, ${folder}`
  );
  for (const { name, from, outcome } of outcomes.sort((first, second) =>
    first.name.localeCompare(second.name)
  )) {
    console.log(`  ${name.padEnd(28)} ${outcome}  [${from}]`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
