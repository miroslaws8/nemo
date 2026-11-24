<script setup lang="ts">
import type { ISkillSummary } from "@shared/types";
import { computed } from "vue";
import { SHADOWED_WORDS, STORE_WORDS } from "@/lib/skills";
import { consoleConfig } from "@/state/config";
import SkillChip from "./SkillChip.vue";

// Where a skill comes from (and which of two of a name runs), what prod runs of a stored one and
// the AI credits, as items of a skills-list row's own flex box (which drops a chip that does not
// fit); the row shows the rest its own way.

const props = defineProps<{ skill: ISkillSummary }>();

const store = computed(
  () =>
    consoleConfig.value?.skillStore ?? {
      kind: "console" as const,
      channels: false,
    }
);
const words = computed(() => STORE_WORDS[store.value.kind]);
const shadowed = computed(() =>
  props.skill.shadowed
    ? SHADOWED_WORDS[props.skill.origin](store.value.kind)
    : null
);
</script>

<template>
  <span class="contents">
    <SkillChip
      v-if="skill.origin === 'console'"
      :tone="skill.shadowed ? 'idle' : 'run'"
      :label="`${words.chip} v${skill.version ?? '?'}`"
      :title="
        shadowed === null
          ? `${words.origin}, not in the repo`
          : `${words.origin}. ${shadowed.words}`
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
      v-if="shadowed !== null"
      tone="idle"
      :label="shadowed.label"
      :title="shadowed.words"
    />
    <SkillChip
      v-if="skill.aiCredits"
      tone="flaky"
      label="AI credits"
      title="It spends AI credits on the environment"
    />
  </span>
</template>
