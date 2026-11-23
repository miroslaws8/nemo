import { agentSkillsSchema } from "@shared/api";
import type { IAgentSkills, IAgentSpend } from "@shared/types";
import type { MaybeRefOrGetter, Ref } from "vue";
import { ref, toValue, watch } from "vue";
import { getJson, messageOf } from "@/lib/api";

// The skills an agent check on an environment may run: hermes/skills of the branch it would test
// (a server console), or of the working tree, with what checks spent today. Loads only while
// `enabled`, and again each time it is enabled (the spend changes during the day).

export function useAgentSkills(
  environment: MaybeRefOrGetter<string>,
  // The branch (a server console); null: the environment's own, or the working tree.
  branch: MaybeRefOrGetter<string | null>,
  enabled: MaybeRefOrGetter<boolean>
): {
  skills: Ref<IAgentSkills["skills"]>;
  spend: Ref<IAgentSpend | null>;
  loading: Ref<boolean>;
  error: Ref<string | null>;
  reload: () => Promise<void>;
} {
  const skills = ref<IAgentSkills["skills"]>([]);
  const spend = ref<IAgentSpend | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  // Only the newest request may change the state.
  let latest = 0;
  let loadedKey = "";

  async function load(refresh: boolean): Promise<void> {
    const environmentName = toValue(environment);
    const branchName = toValue(branch);
    const key = `${environmentName}|${branchName ?? ""}`;
    if (!toValue(enabled)) {
      loadedKey = "";
      return;
    }
    if (environmentName === "" || (key === loadedKey && !refresh)) {
      return;
    }
    latest += 1;
    const request = latest;
    loading.value = true;
    error.value = null;
    const query = new URLSearchParams({ env: environmentName });
    if (branchName !== null) {
      query.set("ref", branchName);
    }
    try {
      const listed = await getJson(
        `/api/agents/skills?${query}`,
        agentSkillsSchema
      );
      if (request === latest) {
        skills.value = listed.skills;
        spend.value = listed.spend;
        loadedKey = key;
      }
    } catch (failure) {
      if (request === latest) {
        skills.value = [];
        spend.value = null;
        loadedKey = "";
        error.value = messageOf(failure);
      }
    } finally {
      if (request === latest) {
        loading.value = false;
      }
    }
  }

  watch(
    [() => toValue(environment), () => toValue(branch), () => toValue(enabled)],
    () => load(false),
    { immediate: true }
  );

  return { skills, spend, loading, error, reload: () => load(true) };
}
