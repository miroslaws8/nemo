<script setup lang="ts">
import type { IAgentSkills } from "@shared/types";
import { computed } from "vue";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";

// The skill an agent check runs (hermes/skills of the branch it tests), one dense row each with
// what it does. A skill the console cannot run yet is listed greyed out, with why.

const props = defineProps<{
  skills: IAgentSkills["skills"];
  loading: boolean;
  error: string | null;
}>();
const skill = defineModel<string>({ required: true });
const emit = defineEmits<{ reload: [] }>();

const chosen = computed(() =>
  props.skills.find((candidate) => candidate.name === skill.value)
);

function choose(value: unknown): void {
  const found = props.skills.find(
    (candidate) => candidate.name === value && candidate.unavailable === null
  );
  if (found !== undefined) {
    skill.value = found.name;
  }
}
</script>

<template>
  <div class="grid min-w-0 gap-2">
    <div
      v-if="loading"
      class="grid gap-1 rounded-md p-2 ring-1 ring-border"
      aria-busy="true"
      aria-label="Reading the skills"
    >
      <Skeleton v-for="row in 3" :key="row" class="h-6 w-full" />
    </div>
    <div
      v-else-if="error !== null"
      class="flex flex-wrap items-center gap-3 rounded-md px-3 py-2 text-sm ring-1 ring-fail/30"
    >
      <p class="min-w-0 flex-1 text-fail">{{ error }}</p>
      <Button type="button" size="sm" variant="outline" @click="emit('reload')">
        Try again
      </Button>
    </div>
    <p v-else-if="skills.length === 0" class="text-sm text-muted-foreground">
      This branch has no skills to run.
    </p>
    <template v-else>
      <RadioGroup
        :model-value="skill"
        aria-label="Skill"
        class="max-h-72 grid-cols-[minmax(0,1fr)] gap-0 overflow-y-auto overscroll-contain rounded-md py-1 ring-1 ring-border"
        @update:model-value="choose"
      >
        <label
          v-for="entry in skills"
          :key="entry.name"
          class="flex h-8 min-w-0 cursor-pointer items-center gap-2.5 px-2.5 transition-colors hover:bg-muted has-[[data-disabled]]:cursor-not-allowed has-[[data-disabled]]:hover:bg-transparent"
          :title="
            entry.unavailable === null
              ? entry.description
              : `Not offered yet: it ${entry.unavailable}`
          "
        >
          <RadioGroupItem
            :value="entry.name"
            :disabled="entry.unavailable !== null"
            class="size-3.5"
          />
          <span
            class="max-w-[60%] shrink-0 truncate text-sm font-medium"
            :class="{ 'text-muted-foreground': entry.unavailable !== null }"
            >{{ entry.name }}</span
          >
          <span
            v-if="entry.origin === 'console'"
            class="shrink-0 rounded-sm bg-run/10 px-1 text-xs font-medium text-run"
            >console v{{ entry.version }}</span
          >
          <span class="min-w-0 flex-1 truncate text-xs text-faint">{{
            entry.unavailable === null
              ? entry.description
              : `Not offered yet: it ${entry.unavailable}`
          }}</span>
        </label>
      </RadioGroup>
      <p
        v-if="chosen !== undefined && chosen.description !== ''"
        class="text-xs text-muted-foreground"
      >
        {{ chosen.description }}
      </p>
    </template>
  </div>
</template>
