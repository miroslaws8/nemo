<script setup lang="ts">
import type { IStepState } from "@shared/types";
import { ref } from "vue";
import { elapsed, formatDuration } from "@/lib/format";
import { STEP_STATUS_LOOKS } from "@/lib/status";
import StatusIcon from "./StatusIcon.vue";
import YamlSnippet from "./YamlSnippet.vue";

// A test's steps as a tree (YAML steps, and setup and template steps inside them). A step's
// file:line opens the YAML around it.

const props = defineProps<{
  runId: string;
  steps: IStepState[];
  now: number;
}>();

const openStepId = ref<string | null>(null);

function toggle(stepId: string): void {
  openStepId.value = openStepId.value === stepId ? null : stepId;
}

// A finished step shows how long it took; only a running one counts up.
function duration(step: IStepState): string {
  if (step.ms !== null) {
    return formatDuration(step.ms);
  }
  return step.status === "running"
    ? formatDuration(elapsed(step.startedAt, null, props.now))
    : "";
}

function fileName(file: string): string {
  return file.slice(file.lastIndexOf("/") + 1);
}

function firstLine(text: string): string {
  return text.split("\n", 1)[0] ?? text;
}
</script>

<template>
  <ol class="text-sm">
    <li
      v-for="step in steps"
      :key="step.stepId"
      class="py-0.5"
      :style="{ paddingLeft: `${step.depth * 1.25}rem` }"
    >
      <div class="flex items-start gap-2">
        <StatusIcon
          :look="STEP_STATUS_LOOKS[step.status]"
          class="mt-0.5 size-3.5"
        />
        <div class="min-w-0 flex-1">
          <span :class="step.kind === 'yaml' ? '' : 'text-muted-foreground'">{{
            step.title
          }}</span>
          <button
            v-if="step.yaml !== null"
            type="button"
            class="ml-2 rounded-sm font-mono text-xs text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
            :title="`${step.yaml.file}:${step.yaml.line}`"
            :aria-expanded="openStepId === step.stepId"
            @click="toggle(step.stepId)"
          >
            {{ fileName(step.yaml.file) }}:{{ step.yaml.line }}
          </button>
          <p
            v-if="step.error !== null"
            class="mt-0.5 font-mono text-xs break-words text-fail"
          >
            {{ firstLine(step.error) }}
          </p>
        </div>
        <span class="shrink-0 text-xs tabular-nums text-muted-foreground">{{
          duration(step)
        }}</span>
      </div>
      <YamlSnippet
        v-if="step.yaml !== null && openStepId === step.stepId"
        :run-id="runId"
        :location="step.yaml"
        mark="step"
        class="mt-1.5 mb-2 ml-5 rounded-md border bg-background"
      />
    </li>
  </ol>
</template>
