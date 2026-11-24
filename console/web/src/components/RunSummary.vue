<script setup lang="ts">
import type { IRunState } from "@shared/types";
import { computed } from "vue";
import { elapsed, formatDuration, plural } from "@/lib/format";
import {
  failureGroups,
  notRunBecauseOfSetup,
  slowestSteps,
  slowestTests,
  summaryFigures,
  timeline,
} from "@/lib/run-summary";
import { TONE_CLASSES } from "@/lib/status";
import ProgressBar from "./ProgressBar.vue";
import SummaryFailures from "./SummaryFailures.vue";
import SummarySlowest from "./SummarySlowest.vue";
import SummaryTimeline from "./SummaryTimeline.vue";

// One test run taken apart: its figures, what failed and why, what was slowest and what each
// worker ran when. Built from the run's live state, so it follows a run that is still going.

const props = defineProps<{ state: IRunState; now: number; going: boolean }>();

const emit = defineEmits<{ open: [testId: string] }>();

const SLOWEST = 10;
const NO_VALUE = "—";

const figures = computed(() => summaryFigures(props.state));
const hasTests = computed(() => figures.value.total > 0);
const groups = computed(() => failureGroups(props.state));
const setupMiss = computed(() => notRunBecauseOfSetup(props.state));
const slowTests = computed(() => slowestTests(props.state, SLOWEST));
const slowSteps = computed(() => slowestSteps(props.state, SLOWEST));
const lanes = computed(() => timeline(props.state));
const spanMs = computed(() =>
  Math.max(
    props.state.ms ?? 0,
    ...lanes.value.flatMap((lane) => lane.bars.map((bar) => bar.endMs))
  )
);

// A run still going counts to now; one that ended without its last event, to that event.
const durationMs = computed(() => {
  const { startedAt, lastEventAt } = props.state;
  if (figures.value.ms !== null) {
    return figures.value.ms;
  }
  if (startedAt === null) {
    return null;
  }
  return elapsed(startedAt, props.going ? null : lastEventAt, props.now);
});

const passedPercent = computed(() =>
  figures.value.total === 0
    ? 0
    : Math.round((figures.value.passed / figures.value.total) * 100)
);

// Literal classes per cell: two to a row on a phone, four from `sm`, hairlines between.
const CELL_BORDERS = [
  "pl-0",
  "border-l",
  "max-sm:border-t max-sm:pl-0 sm:border-l",
  "border-l max-sm:border-t",
];

const cells = computed(() => {
  const { total, failed, flaky, retried } = figures.value;
  const shown = (value: number): string =>
    hasTests.value ? String(value) : NO_VALUE;
  return [
    { label: "Tests", value: shown(total), tone: "", note: null },
    {
      label: "Failed",
      value: shown(failed),
      tone: failed > 0 ? TONE_CLASSES.fail.text : "",
      note: null,
    },
    {
      label: "Flaky",
      value: shown(flaky),
      tone: "",
      note: retried > 0 ? plural(retried, "retry", "retries") : null,
    },
    {
      label: "Duration",
      value:
        durationMs.value === null ? NO_VALUE : formatDuration(durationMs.value),
      tone: "",
      note: null,
    },
  ].map((cell, index) => ({ ...cell, border: CELL_BORDERS[index] ?? "" }));
});
</script>

<template>
  <div class="space-y-8">
    <section aria-label="Figures">
      <dl class="grid grid-cols-2 sm:grid-cols-4">
        <div
          v-for="cell in cells"
          :key="cell.label"
          class="min-w-0 px-4 py-2.5"
          :class="cell.border"
        >
          <dt class="text-xs text-muted-foreground">{{ cell.label }}</dt>
          <dd class="mt-0.5 flex items-baseline gap-1.5 whitespace-nowrap">
            <span
              class="text-2xl font-semibold tabular-nums"
              :class="cell.tone"
              >{{ cell.value }}</span
            >
            <span v-if="cell.note !== null" class="text-xs text-faint">{{
              cell.note
            }}</span>
          </dd>
        </div>
      </dl>
      <div v-if="hasTests" class="mt-3 flex items-center gap-3">
        <ProgressBar :counts="state.counts" :height="4" class="flex-1" />
        <span
          class="shrink-0 text-xs whitespace-nowrap text-muted-foreground tabular-nums"
          >{{ passedPercent }}% passed</span
        >
      </div>
      <p v-else class="mt-3 text-sm text-faint">Waiting for the first test.</p>
    </section>

    <template v-if="hasTests">
      <SummaryFailures
        :groups="groups"
        :setup-miss="setupMiss"
        :going="going"
        @open="emit('open', $event)"
      />
      <SummarySlowest :tests="slowTests" :steps="slowSteps" :going="going" />
      <SummaryTimeline
        v-if="lanes.length > 0"
        :lanes="lanes"
        :span-ms="spanMs"
      />
    </template>
  </div>
</template>
