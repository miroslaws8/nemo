<script setup lang="ts">
import { CircleXIcon, TriangleAlertIcon } from "@lucide/vue";
import type { ISkillProblem } from "@shared/types";
import { fieldLabel } from "@/lib/skill-draft";
import SkillText from "./SkillText.vue";

// What the console found in a skill.yaml: errors stop it from being added, warnings do not. A
// problem takes you to its place: its line in the file, or its field in the form (`locate`).

const props = defineProps<{
  problems: ISkillProblem[];
  locate: "line" | "field";
}>();
const emit = defineEmits<{ show: [problem: ISkillProblem] }>();

function placeOf(problem: ISkillProblem): string | null {
  if (props.locate === "field") {
    return problem.path.length === 0 ? null : fieldLabel(problem.path);
  }
  if (problem.line === null) {
    return null;
  }
  return problem.column === null
    ? `line ${problem.line}`
    : `line ${problem.line}:${problem.column}`;
}
</script>

<template>
  <ul class="grid gap-2 text-sm">
    <li
      v-for="(problem, index) in problems"
      :key="index"
      class="flex items-start gap-2 rounded-md border px-3 py-2"
      :class="
        problem.severity === 'error'
          ? 'border-fail/30 bg-fail/5'
          : 'border-flaky/30 bg-flaky/5'
      "
    >
      <CircleXIcon
        v-if="problem.severity === 'error'"
        class="mt-0.5 size-4 shrink-0 text-fail"
        aria-label="Error"
      />
      <TriangleAlertIcon
        v-else
        class="mt-0.5 size-4 shrink-0 text-flaky"
        aria-label="Warning"
      />
      <div class="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
        <button
          v-if="placeOf(problem) !== null"
          type="button"
          class="shrink-0 rounded-sm font-mono text-xs text-run underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
          @click="emit('show', problem)"
        >
          {{ placeOf(problem) }}
        </button>
        <SkillText class="inline break-words" :text="problem.message" />
      </div>
    </li>
  </ul>
</template>
