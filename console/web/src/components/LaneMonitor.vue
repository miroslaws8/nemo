<script setup lang="ts">
import { LoaderCircleIcon } from "@lucide/vue";
import type { ITestState } from "@shared/types";
import { computed } from "vue";
import { elapsed, formatDuration } from "@/lib/format";
import { hideBroken, showLoaded } from "@/lib/images";
import { runFileUrl } from "@/lib/paths";

// One Playwright worker as it goes: what its browser showed at the last step, the test and
// the YAML step it is on now.

const props = defineProps<{
  runId: string;
  lane: number;
  test: ITestState;
  now: number;
}>();

const step = computed(() =>
  props.test.steps.find(
    (candidate) => candidate.stepId === props.test.currentStepId
  )
);

const shotUrl = computed(() =>
  props.test.shot === null
    ? null
    : `${runFileUrl(props.runId, props.test.shot)}?v=${
        props.test.shotVersion ?? 0
      }`
);

const testTime = computed(() =>
  props.test.startedAt === null
    ? ""
    : formatDuration(elapsed(props.test.startedAt, null, props.now))
);

const stepTime = computed(() =>
  step.value === undefined
    ? ""
    : formatDuration(elapsed(step.value.startedAt, null, props.now))
);
</script>

<template>
  <article
    class="flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card"
  >
    <a
      v-if="shotUrl !== null"
      :href="shotUrl"
      target="_blank"
      rel="noopener"
      class="relative block aspect-[16/10] bg-muted outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
    >
      <img
        :src="shotUrl"
        :alt="`What worker ${lane + 1} showed at its last step`"
        class="size-full object-cover object-top"
        @error="hideBroken"
        @load="showLoaded"
      />
    </a>
    <div
      v-else
      class="grid aspect-[16/10] place-items-center bg-muted text-sm text-muted-foreground"
    >
      The first screenshot comes with the first step
    </div>
    <div class="flex flex-1 flex-col gap-2 p-3">
      <div class="flex items-baseline gap-2 text-xs text-muted-foreground">
        <span class="font-medium text-foreground">Worker {{ lane + 1 }}</span>
        <span v-if="test.retry > 0" class="text-flaky"
          >attempt {{ test.retry + 1 }}</span
        >
        <span class="ml-auto tabular-nums">{{ testTime }}</span>
      </div>
      <div class="min-w-0">
        <p class="truncate text-sm font-medium" :title="test.title">
          {{ test.title }}
        </p>
        <p class="truncate text-xs text-muted-foreground" :title="test.suite">
          {{ test.suite || test.spec }}
        </p>
      </div>
      <div
        v-if="step !== undefined"
        class="mt-auto flex items-start gap-2 rounded-md bg-run/10 px-2.5 py-2"
      >
        <LoaderCircleIcon
          class="mt-0.5 size-3.5 shrink-0 text-run motion-safe:animate-spin"
          aria-hidden="true"
        />
        <div class="min-w-0 flex-1">
          <p class="text-sm leading-snug break-words">{{ step.title }}</p>
          <p class="mt-0.5 flex gap-2 font-mono text-xs text-muted-foreground">
            <span v-if="step.yaml !== null" class="truncate">{{
              `${step.yaml.file}:${step.yaml.line}`
            }}</span>
            <span class="ml-auto shrink-0 tabular-nums">{{ stepTime }}</span>
          </p>
        </div>
      </div>
    </div>
  </article>
</template>
