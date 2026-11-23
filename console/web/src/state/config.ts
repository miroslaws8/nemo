import { consoleConfigSchema } from "@shared/api";
import type {
  IConsoleConfig,
  IEnvironmentInfo,
  ISkillStoreKind,
  ITierInfo,
} from "@shared/types";
import { computed, ref } from "vue";
import { getJson } from "@/lib/api";
import type { IStoreWords } from "@/types";

// The environments, tiers and profiles from e2e.config.yaml, loaded once per page.

export const consoleConfig = ref<IConsoleConfig | null>(null);

let loading: Promise<void> | null = null;

export function loadConfig(): Promise<void> {
  if (loading === null) {
    loading = getJson("/api/config", consoleConfigSchema)
      .then((config) => {
        consoleConfig.value = config;
      })
      .catch((error: unknown) => {
        loading = null;
        throw error;
      });
  }
  return loading;
}

const STORE_WORDS: Record<ISkillStoreKind, IStoreWords> = {
  "working-tree": {
    skills: "The skills of this working copy (hermes/skills).",
    addSkill:
      "Adding writes hermes/skills/{name}/ (its skill.yaml and SKILL.md) in this working copy: commit it to share it.",
    replaceSkill:
      "Saving rewrites hermes/skills/{name}/skill.yaml and its SKILL.md in this working copy.",
  },
  console: {
    skills:
      "The repo's skills (hermes/skills of a branch) and the ones added in this console.",
    addSkill:
      "Adding saves it in this console: it runs at once on every environment and stays out of the repo (download its skill.yaml to add it there).",
    replaceSkill:
      "Saving makes it version {version} in this console; a check that ran an earlier version keeps it when run again.",
  },
  registry: {
    skills:
      "The repo's skills (hermes/skills of a branch) and the skill store's, which every console shares: of two with one name, the store's runs.",
    addSkill:
      "Adding saves it in the skill store, which every console shares: it runs at once on local and staging, and on prod once a version is promoted.",
    replaceSkill:
      "Saving makes it version {version} in the skill store: local and staging run it at once, prod keeps its promoted version; a check that ran an earlier version keeps it when run again.",
  },
};

/** What this console's skill store means for the Skills pages. */
export const storeWords = computed(
  () => STORE_WORDS[consoleConfig.value?.skillStore.kind ?? "working-tree"]
);

export function environmentNamed(name: string): IEnvironmentInfo | undefined {
  return consoleConfig.value?.environments.find(
    (environment) => environment.name === name
  );
}

export function tierNamed(name: string): ITierInfo | undefined {
  return consoleConfig.value?.tiers.find((tier) => tier.name === name);
}

export function isGuarded(environment: string): boolean {
  return environmentNamed(environment)?.guarded ?? false;
}
