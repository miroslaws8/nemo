<script setup lang="ts">
import { ChevronRightIcon } from "@lucide/vue";
import type { ICiReport, IRunCounts } from "@shared/types";
import { computed, ref } from "vue";
import { TEST_STATUS_LOOKS } from "@/lib/status";
import RunProgress from "./RunProgress.vue";
import StatusIcon from "./StatusIcon.vue";

// A CI step's test report (its JUnit file, as Bitbucket keeps it): the counts as a run's, then
// every failed test as a row that opens to what went wrong.

const props = defineProps<{ report: ICiReport }>();

const counts = computed(
  (): IRunCounts => ({
    total: props.report.total,
    passed: props.report.passed,
    failed: props.report.failed,
    flaky: 0,
    skipped: props.report.skipped,
    interrupted: 0,
    running: 0,
    queued: 0,
  })
);

// The failed tests opened, by their place in the report.
const expanded = ref(new Set<number>());

function toggle(index: number): void {
  const next = new Set(expanded.value);
  if (next.has(index)) {
    next.delete(index);
  } else {
    next.add(index);
  }
  expanded.value = next;
}
</script>

<template>
  <section class="min-w-0 space-y-4">
    <RunProgress :counts="counts" :finished="true" />
    <ul
      v-if="report.failedCases.length > 0"
      aria-label="Failed tests"
      class="border-t border-border/60"
    >
      <li
        v-for="(testCase, index) in report.failedCases"
        :key="index"
        class="border-b border-border/60"
      >
        <button
          type="button"
          class="flex h-9 w-full items-center gap-3 px-2 text-left text-sm outline-none transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
          :aria-expanded="expanded.has(index)"
          @click="toggle(index)"
        >
          <StatusIcon :look="TEST_STATUS_LOOKS.failed" />
          <span class="flex min-w-0 flex-1 items-baseline gap-2">
            <span class="truncate font-medium" :title="testCase.name">{{
              testCase.name
            }}</span>
            <span
              v-if="testCase.suite !== null"
              class="min-w-0 shrink-[100] truncate text-faint max-sm:hidden"
              :title="testCase.suite"
              >{{ testCase.suite }}</span
            >
          </span>
          <ChevronRightIcon
            class="size-4 shrink-0 text-faint transition-transform duration-150 ease-out"
            :class="expanded.has(index) ? 'rotate-90' : ''"
            aria-hidden="true"
          />
        </button>
        <div v-if="expanded.has(index)" class="space-y-2 pr-2 pb-3 pl-8.5">
          <p
            v-if="testCase.suite !== null"
            class="text-xs break-words text-faint sm:hidden"
          >
            {{ testCase.suite }}
          </p>
          <p v-if="testCase.reasons.length === 0" class="text-sm text-faint">
            The report gives no reason.
          </p>
          <pre
            v-for="(reason, reasonIndex) in testCase.reasons"
            :key="reasonIndex"
            class="max-h-72 overflow-auto rounded-md bg-muted px-3 py-2.5 font-mono text-xs leading-relaxed whitespace-pre-wrap text-fail"
            >{{ reason }}</pre
          >
        </div>
      </li>
    </ul>
  </section>
</template>
