<script setup lang="ts">
import type { IRunState, ITestState, ITestStatus } from "@shared/types";
import { computed, nextTick, ref, watch } from "vue";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { ITestFilter } from "@/types";
import TestRow from "./TestRow.vue";

// Every test of the run in Playwright's order, filtered by outcome. A finished run with
// failures opens on them, the first one unfolded; a test opened from the Summary tab
// (`openTestId`) instead.

const props = defineProps<{
  runId: string;
  state: IRunState;
  now: number;
  finished: boolean;
  canRetry: boolean;
  hasReport: boolean;
  // Its attachments may be opened (prod's take an operator).
  filesAllowed: boolean;
  // A test to show unfolded and scroll to (the Summary tab opened it).
  openTestId?: string | null;
}>();

const emit = defineEmits<{ retryTest: [testId: string] }>();

const FILTERS: Record<
  ITestFilter,
  { label: string; statuses: ReadonlySet<ITestStatus> | null }
> = {
  all: { label: "All", statuses: null },
  failed: { label: "Failed", statuses: new Set(["failed", "timedOut"]) },
  flaky: { label: "Flaky", statuses: new Set(["flaky"]) },
  running: { label: "Running", statuses: new Set(["running"]) },
  passed: { label: "Passed", statuses: new Set(["passed"]) },
  rest: {
    label: "Not run",
    statuses: new Set(["queued", "skipped", "interrupted"]),
  },
};

const FILTER_ORDER: ITestFilter[] = [
  "all",
  "failed",
  "flaky",
  "running",
  "passed",
  "rest",
];

const tests = computed(() =>
  props.state.order.flatMap((testId) => {
    const test = props.state.tests[testId];
    return test === undefined ? [] : [test];
  })
);

function matches(filter: ITestFilter, test: ITestState): boolean {
  const statuses = FILTERS[filter].statuses;
  return statuses === null || statuses.has(test.status);
}

// "All" always shows; the others only while some test fits them.
const filters = computed(() =>
  FILTER_ORDER.flatMap((filter) => {
    const count = tests.value.filter((test) => matches(filter, test)).length;
    return filter === "all" || count > 0
      ? [{ filter, label: FILTERS[filter].label, count }]
      : [];
  })
);

const filter = ref<ITestFilter>("all");
const expanded = ref<ReadonlySet<string>>(new Set());
let openedOnFailures = false;

// Once the run is over (or loads already over): show its failures, the first one open.
watch(
  () => [props.finished, tests.value.length],
  () => {
    if (openedOnFailures || !props.finished) {
      return;
    }
    const firstFailure = tests.value.find((test) => matches("failed", test));
    if (firstFailure === undefined) {
      return;
    }
    openedOnFailures = true;
    filter.value = "failed";
    expanded.value = new Set([firstFailure.testId]);
  },
  { immediate: true }
);

// A test asked for from the Summary: in a filter that shows it, unfolded, scrolled to. It wins
// over the first failure above (this watch runs after that one).
const list = ref<HTMLElement | null>(null);
let openedTestId: string | null = null;
watch(
  [() => props.openTestId, () => tests.value.length],
  ([testId]) => {
    const test = tests.value.find((candidate) => candidate.testId === testId);
    if (test === undefined || testId === openedTestId) {
      return;
    }
    openedTestId = test.testId;
    openedOnFailures = true;
    if (!matches(filter.value, test)) {
      filter.value =
        FILTER_ORDER.find(
          (candidate) => candidate !== "all" && matches(candidate, test)
        ) ?? "all";
    }
    expanded.value = new Set([test.testId]);
    void nextTick(() => {
      list.value
        ?.querySelector(`[data-test-id="${CSS.escape(test.testId)}"]`)
        ?.scrollIntoView({ block: "start" });
    });
  },
  { immediate: true }
);

// A filter that no test fits any more falls back to "All".
watch(filters, (available) => {
  if (!available.some((entry) => entry.filter === filter.value)) {
    filter.value = "all";
  }
});

const visible = computed(() =>
  tests.value.filter((test) => matches(filter.value, test))
);

function chooseFilter(value: unknown): void {
  const chosen = FILTER_ORDER.find((candidate) => candidate === value);
  if (chosen !== undefined) {
    filter.value = chosen;
  }
}

function toggle(testId: string): void {
  const next = new Set(expanded.value);
  if (!next.delete(testId)) {
    next.add(testId);
  }
  expanded.value = next;
}
</script>

<template>
  <section ref="list" class="min-w-0">
    <header class="flex flex-wrap items-center gap-2 border-b pb-2">
      <ToggleGroup
        type="single"
        size="sm"
        :model-value="filter"
        aria-label="Show tests"
        @update:model-value="chooseFilter"
      >
        <ToggleGroupItem
          v-for="entry in filters"
          :key="entry.filter"
          :value="entry.filter"
          class="gap-1.5"
        >
          {{ entry.label }}
          <span class="tabular-nums text-muted-foreground">{{
            entry.count
          }}</span>
        </ToggleGroupItem>
      </ToggleGroup>
    </header>
    <ul v-if="visible.length > 0">
      <TestRow
        v-for="test in visible"
        :key="test.testId"
        :data-test-id="test.testId"
        :run-id="runId"
        :test="test"
        :now="now"
        :expanded="expanded.has(test.testId)"
        :can-retry="canRetry"
        :has-report="hasReport"
        :files-allowed="filesAllowed"
        @toggle="toggle(test.testId)"
        @retry="emit('retryTest', test.testId)"
      />
    </ul>
    <p v-else class="px-4 py-10 text-center text-sm text-muted-foreground">
      {{
        tests.length === 0
          ? "The tests show up here once Playwright has listed them."
          : "No test fits this filter."
      }}
    </p>
  </section>
</template>
