<script setup lang="ts">
import type { ISkillSummary } from "@shared/types";
import { computed } from "vue";
import { STORE_WORDS } from "@/lib/skills";
import { consoleConfig } from "@/state/config";
import SkillChip from "./SkillChip.vue";

// Where a skill comes from (and which of two of a name runs), what prod runs of a stored one and
// the AI credits, as items of a skills-list row's own flex box (which drops a chip that does not
// fit); the row shows the rest its own way.

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
  <span class="contents">
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
      v-if="skill.aiCredits"
      tone="flaky"
      label="AI credits"
      title="It spends AI credits on the environment"
    />
  </span>
</template>
