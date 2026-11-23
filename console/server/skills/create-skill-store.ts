import path from "node:path";
import { CONSOLE_SKILLS_DIR } from "../settings";
import type { IConsoleMode, IConsoleSettings } from "../types";
import { RegistrySkills } from "./skill-registry";
import {
  ConsoleSkills,
  type ISkillStore,
  WorkingTreeSkills,
} from "./skill-stores";

// The console's skill store, by its mode (skill-stores.ts says where each keeps skills); given a
// bucket (QA_CONSOLE_SKILLS_*), every console keeps them there, the team's and each Mac's.
const SKILL_STORES: Record<
  IConsoleMode,
  (settings: IConsoleSettings) => ISkillStore
> = {
  local: (settings) =>
    settings.skillRegistry === null
      ? new WorkingTreeSkills()
      : new RegistrySkills(settings.skillRegistry, settings.dataDir, null),
  server: (settings) =>
    settings.skillRegistry === null
      ? new ConsoleSkills(path.join(settings.dataDir, CONSOLE_SKILLS_DIR))
      : new RegistrySkills(settings.skillRegistry, settings.dataDir, null),
};

export function createSkillStore(settings: IConsoleSettings): ISkillStore {
  return SKILL_STORES[settings.mode](settings);
}
