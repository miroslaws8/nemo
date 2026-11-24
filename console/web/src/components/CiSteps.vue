<script setup lang="ts">
import type { ICiStep } from "@shared/types";
import { elapsed, formatDuration } from "@/lib/format";
import { CI_STEP_LOOKS } from "@/lib/status";
import StatusIcon from "./StatusIcon.vue";

// A CI pipeline's steps, each a button that shows its log. From `md` a pipeline track: compact
// chips joined by a line, wrapping when there are many; below that the same buttons as rows.

defineProps<{
  steps: ICiStep[];
  // The step whose log shows.
  selected: string | null;
  now: number;
}>();

const emit = defineEmits<{ select: [step: ICiStep] }>();

function stepDuration(step: ICiStep, now: number): string {
  return step.startedAt === null
    ? ""
    : formatDuration(elapsed(step.startedAt, step.endedAt, now));
}
</script>

<template>
  <!-- The line before a chip sits in the gap; at the start of a wrapped line it is clipped. -->
  <ol
    aria-label="Steps"
    class="md:flex md:flex-wrap md:items-center md:gap-x-4 md:gap-y-2 md:overflow-hidden"
  >
    <li
      v-for="(step, index) in steps"
      :key="step.uuid"
      class="relative border-b border-border/60 md:min-w-0 md:border-0"
      :class="
        index > 0
          ? 'md:before:absolute md:before:top-1/2 md:before:right-full md:before:h-px md:before:w-4 md:before:bg-border'
          : ''
      "
    >
      <button
        type="button"
        class="flex h-9 w-full min-w-0 items-center gap-2 px-2 text-left text-sm ring-inset outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 md:h-8 md:w-auto md:max-w-64 md:rounded-md md:px-2.5 md:ring-1 md:focus-visible:ring-3 md:focus-visible:ring-ring/50"
        :class="
          step.uuid === selected
            ? 'bg-accent md:ring-foreground/20'
            : 'hover:bg-muted md:ring-border'
        "
        :aria-pressed="step.uuid === selected"
        @click="emit('select', step)"
      >
        <StatusIcon :look="CI_STEP_LOOKS[step.status]" />
        <span class="min-w-0 flex-1 truncate" :title="step.name">{{
          step.name
        }}</span>
        <span
          v-if="step.startedAt !== null"
          class="shrink-0 text-xs text-faint tabular-nums"
          >{{ stepDuration(step, now) }}</span
        >
      </button>
    </li>
  </ol>
</template>
