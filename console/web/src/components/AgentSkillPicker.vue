<script setup lang="ts">
import type { IAgentSkills } from "@shared/types";
import { computed, useId } from "vue";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

// The skill an agent check runs (hermes/skills of the branch it tests), with what it does. A skill
// the console cannot run yet is listed greyed out, with why.

const props = defineProps<{
  skills: IAgentSkills["skills"];
  loading: boolean;
  error: string | null;
}>();
const skill = defineModel<string>({ required: true });
const emit = defineEmits<{ reload: [] }>();

const id = useId();
const chosen = computed(() =>
  props.skills.find((candidate) => candidate.name === skill.value)
);
// The skills it cannot run yet, by why.
const unavailable = computed(() => {
  const byReason = new Map<string, string[]>();
  for (const candidate of props.skills) {
    if (candidate.unavailable !== null) {
      byReason.set(candidate.unavailable, [
        ...(byReason.get(candidate.unavailable) ?? []),
        candidate.name,
      ]);
    }
  }
  return [...byReason].map(([reason, names]) => ({ reason, names }));
});

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
    <Label :for="id">Skill</Label>
    <div v-if="loading" class="grid gap-2" aria-busy="true">
      <Skeleton class="h-9 w-full" />
      <p class="text-xs text-muted-foreground">Reading the skills…</p>
    </div>
    <div
      v-else-if="error !== null"
      class="flex flex-wrap items-center gap-3 rounded-md border border-fail/30 px-3 py-2.5 text-sm"
    >
      <p class="min-w-0 flex-1 text-fail">{{ error }}</p>
      <Button type="button" size="sm" variant="outline" @click="emit('reload')">
        Try again
      </Button>
    </div>
    <template v-else>
      <Select :model-value="skill" @update:model-value="choose">
        <SelectTrigger :id="id" class="w-full">
          <SelectValue placeholder="Pick a skill" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem
            v-for="entry in skills"
            :key="entry.name"
            :value="entry.name"
            :disabled="entry.unavailable !== null"
          >
            {{ entry.name }}
            <span
              v-if="entry.origin === 'console'"
              class="rounded-sm bg-run/10 px-1 py-px text-xs font-medium text-run"
              >console v{{ entry.version }}</span
            >
          </SelectItem>
        </SelectContent>
      </Select>
      <p v-if="chosen !== undefined" class="text-xs text-muted-foreground">
        {{ chosen.description }}
      </p>
      <p
        v-for="group in unavailable"
        :key="group.reason"
        class="text-xs text-muted-foreground"
      >
        Not offered yet: {{ group.names.join(", ") }} —
        {{ group.names.length === 1 ? "it" : "each" }} {{ group.reason }}.
      </p>
    </template>
  </div>
</template>
