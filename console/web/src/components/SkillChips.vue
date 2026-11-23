<script setup lang="ts">
import type { ISkillSummary } from "@shared/types";
import { computed } from "vue";
import { SAFETY_WORDS, STORE_WORDS } from "@/lib/skills";
import { consoleConfig } from "@/state/config";
import SkillChip from "./SkillChip.vue";

// What a skill changes, where it comes from (and which of two of a name runs), what prod runs of a
// stored one, where CI runs it and why the console would not.

defineProps<{ skill: ISkillSummary }>();

const store = computed(
  () =>
    consoleConfig.value?.skillStore ?? {
      kind: "console" as const,
      channels: false,
    }
);
const words = computed(() => STORE_WORDS[store.value.kind]);
</script>

<template>
  <span class="inline-flex flex-wrap items-center gap-1.5">
    <SkillChip
      v-if="skill.origin === 'console'"
      :tone="skill.shadowed ? 'idle' : 'run'"
      :label="`${words.chip} v${skill.version ?? '?'}`"
      :title="
        skill.shadowed
          ? `${words.origin}; the repo has a skill of this name, and that one runs`
          : `${words.origin}, not in the repo`
      "
    />
    <SkillChip
      v-if="skill.origin === 'console' && store.channels"
      :tone="skill.prodVersion === null ? 'idle' : 'pass'"
      :label="
        skill.prodVersion === null
          ? 'Not on prod yet'
          : `Prod v${skill.prodVersion}`
      "
      :title="
        skill.prodVersion === null
          ? 'No version is promoted to prod: prod does not run it'
          : `Prod runs v${skill.prodVersion}; staging and local the newest`
      "
    />
    <SkillChip
      v-if="skill.shadowed"
      tone="idle"
      :label="
        skill.origin === 'repo'
          ? `Shadowed by ${words.place}`
          : 'Shadowed by the repo'
      "
      :title="
        skill.origin === 'repo'
          ? `${words.place} has a skill of this name: that one runs`
          : 'The repo has a skill of this name on this branch: that one runs'
      "
    />
    <SkillChip
      v-if="skill.safety !== null"
      :tone="SAFETY_WORDS[skill.safety].tone"
      :label="SAFETY_WORDS[skill.safety].label"
      :title="SAFETY_WORDS[skill.safety].hint"
    />
    <SkillChip
      v-if="skill.aiCredits"
      tone="flaky"
      label="AI credits"
      title="It spends AI credits on the environment"
    />
    <SkillChip
      v-if="skill.afterDeploys.length > 0"
      tone="pass"
      :label="`After deploys: ${skill.afterDeploys.join(', ')}`"
      title="CI runs it after each deploy and on its schedule (agent_checks in e2e.config.yaml)"
    />
    <SkillChip
      v-if="skill.problem !== null"
      tone="fail"
      label="skill.yaml has a problem"
      :title="skill.problem"
    />
    <SkillChip
      v-else-if="skill.unavailable !== null"
      tone="idle"
      label="Not in the console"
      :title="`The console does not run it: it ${skill.unavailable}`"
    />
  </span>
</template>
