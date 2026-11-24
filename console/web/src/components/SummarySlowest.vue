<script setup lang="ts">
import { computed } from "vue";
import { formatDuration } from "@/lib/format";
import type { ISlowRow, ISlowStep, ISlowTest } from "@/types";

// The run's slowest tests and slowest YAML steps side by side (stacked on a narrow page): each
// row a neutral bar, its length the share of the slowest one. A row opens its test (a step's,
// the test it belongs to) in the Tests tab.

const props = defineProps<{
  tests: ISlowTest[];
  steps: ISlowStep[];
  going: boolean;
}>();

const emit = defineEmits<{ open: [testId: string] }>();

function shareOf(ms: number, slowest: number): number {
  return slowest <= 0 ? 0 : (ms / slowest) * 100;
}

const lists = computed(() => {
  const slowestTest = props.tests[0]?.ms ?? 0;
  const slowestStep = props.steps[0]?.ms ?? 0;
  const testRows = props.tests.map(
    (test): ISlowRow => ({
      key: test.testId,
      testId: test.testId,
      title: test.title,
      testTitle: test.title,
      context: test.step?.title ?? null,
      ms: test.ms,
      share: shareOf(test.ms, slowestTest),
    })
  );
  const stepRows = props.steps.map(
    (step): ISlowRow => ({
      key: `${step.testId}/${step.stepId}`,
      testId: step.testId,
      title: step.title,
      testTitle: step.testTitle,
      context: step.testTitle,
      ms: step.ms,
      share: shareOf(step.ms, slowestStep),
    })
  );
  return [
    {
      id: "summary-slowest-tests",
      title: "Slowest tests",
      empty: props.going ? "No test has finished yet." : "No test finished.",
      rows: testRows,
    },
    {
      id: "summary-slowest-steps",
      title: "Slowest steps",
      empty: props.going
        ? "No YAML step has finished yet."
        : "No YAML step ran.",
      rows: stepRows,
    },
  ];
});
</script>

<template>
  <div class="grid gap-8 lg:grid-cols-2 lg:gap-6">
    <section
      v-for="list in lists"
      :key="list.id"
      :aria-labelledby="list.id"
      class="min-w-0"
    >
      <header class="flex items-baseline justify-between gap-3 border-b pb-2">
        <h3 :id="list.id" class="text-sm font-semibold">{{ list.title }}</h3>
      </header>
      <ul v-if="list.rows.length > 0">
        <li
          v-for="row in list.rows"
          :key="row.key"
          class="border-b border-border/60"
        >
          <button
            type="button"
            class="flex h-9 w-full items-center gap-3 px-2 text-left text-sm outline-none transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
            :title="`Open “${row.testTitle}” in Tests`"
            @click="emit('open', row.testId)"
          >
            <span class="flex min-w-0 flex-1 items-baseline gap-2">
              <span class="max-w-full shrink-0 truncate" :title="row.title">{{
                row.title
              }}</span>
              <span
                v-if="row.context !== null"
                class="min-w-0 shrink-[100] truncate text-xs text-faint max-sm:hidden"
                :title="row.context"
                >{{ row.context }}</span
              >
            </span>
            <span class="h-1.5 w-16 shrink-0 sm:w-24" aria-hidden="true">
              <span
                class="block h-full rounded-r-sm bg-foreground/15"
                :style="{ width: `${row.share}%` }"
              />
            </span>
            <span
              class="w-14 shrink-0 text-right whitespace-nowrap text-muted-foreground tabular-nums"
              >{{ formatDuration(row.ms) }}</span
            >
          </button>
        </li>
      </ul>
      <p v-else class="px-2 py-3 text-sm text-faint">{{ list.empty }}</p>
    </section>
  </div>
</template>
