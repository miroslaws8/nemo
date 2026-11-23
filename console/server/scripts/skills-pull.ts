import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SKILL_CHANNELS } from "../../../engine/config";
import {
  parseSkillSource,
  SKILL_FILE,
  SKILL_SOURCE,
} from "../../../engine/skills";
import type { ISkillChannel } from "../../../engine/types";
import { consoleSettings } from "../config";
import { skillTemplate } from "../skills/skill-reader";
import {
  registryFolder,
  SkillBucket,
  storedMetas,
} from "../skills/skill-registry";
import { versionOn } from "../skills/skill-stores";

// pnpm skills:pull [--channel prod] [--to <folder>]: the skill store's skills (QA_CONSOLE_SKILLS_*;
// a key that may read is enough) as Hermes reads them, for Hermes run by hand: each one's
// <folder>/<name>/SKILL.md (default ~/.hermes/skills), made from this checkout's template, of the
// version a channel runs (latest by default). A skill the store has replaces hermes/install.sh's
// link of that name, as the console's own checks do.

function optionAfter(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

function channelOf(value: string | null): ISkillChannel {
  const channel = SKILL_CHANNELS.find((known) => known === (value ?? "latest"));
  if (channel === undefined) {
    throw new Error(`--channel takes ${SKILL_CHANNELS.join(" or ")}`);
  }
  return channel;
}

async function main(): Promise<void> {
  const channel = channelOf(optionAfter("--channel"));
  const target = path.resolve(
    optionAfter("--to") ?? path.join(os.homedir(), ".hermes", "skills")
  );
  const registry = consoleSettings().skillRegistry;
  if (registry === null) {
    throw new Error(
      "No skill store here: set QA_CONSOLE_SKILLS_BUCKET and its key (README → Skills)"
    );
  }
  const bucket = new SkillBucket(registry);
  const folder = registryFolder(registry);
  const template = skillTemplate();
  fs.mkdirSync(target, { recursive: true });
  console.log(
    `Skill store: bucket ${registry.bucket}, ${folder}; ${channel} → ${target}`
  );
  for (const [name, meta] of [...(await storedMetas(bucket, folder))].sort()) {
    const version = versionOn(channel, meta);
    if (version === null) {
      console.log(`  ${name.padEnd(28)} left: no version on ${channel}`);
      continue;
    }
    const yaml = await bucket.read(
      `${folder}${name}/v${version}/${SKILL_SOURCE}`
    );
    const read = parseSkillSource(name, yaml, template);
    if (read.skillMd === null) {
      console.log(
        `  ${name.padEnd(28)} left: v${version} does not read as a skill`
      );
      continue;
    }
    const skillFolder = path.join(target, name);
    if (
      fs.lstatSync(skillFolder, { throwIfNoEntry: false })?.isSymbolicLink()
    ) {
      fs.unlinkSync(skillFolder);
    }
    fs.mkdirSync(skillFolder, { recursive: true });
    fs.writeFileSync(path.join(skillFolder, SKILL_FILE), read.skillMd);
    fs.writeFileSync(path.join(skillFolder, SKILL_SOURCE), yaml);
    console.log(`  ${name.padEnd(28)} v${version}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
