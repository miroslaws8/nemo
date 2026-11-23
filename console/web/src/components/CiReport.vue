<script setup lang="ts">
import type { ICiReport, IRunCounts } from "@shared/types";
import { computed } from "vue";
import { TEST_STATUS_LOOKS } from "@/lib/status";
import RunProgress from "./RunProgress.vue";
import StatusIcon from "./StatusIcon.vue";

// A CI step's test report (its JUnit file, as Bitbucket keeps it): the counts and every failed
// test with what went wrong.

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
</script>

<template>
  <section class="space-y-4">
    <RunProgress :counts="counts" :finished="true" />
    <ul
      v-if="report.failedCases.length > 0"
      class="divide-y overflow-hidden rounded-lg border bg-card"
    >
      <li
        v-for="(testCase, index) in report.failedCases"
        :key="index"
        class="space-y-2 px-4 py-3"
      >
        <div class="flex items-start gap-3">
          <StatusIcon :look="TEST_STATUS_LOOKS.failed" class="mt-0.5" />
          <div class="min-w-0">
            <p class="text-sm font-medium break-words">{{ testCase.name }}</p>
            <p
              v-if="testCase.suite !== null"
              class="text-xs break-words text-muted-foreground"
            >
              {{ testCase.suite }}
            </p>
          </div>
        </div>
        <pre
          v-for="(reason, reasonIndex) in testCase.reasons"
          :key="reasonIndex"
          class="ml-7 max-h-72 overflow-auto rounded-md border border-fail/30 bg-background px-3 py-2.5 font-mono text-xs leading-relaxed whitespace-pre-wrap text-fail"
          >{{ reason }}</pre
        >
      </li>
    </ul>
  </section>
</template>
