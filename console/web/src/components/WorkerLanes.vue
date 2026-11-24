<script setup lang="ts">
import type { IRunState, ITestState } from "@shared/types";
import { computed } from "vue";
import LaneMonitor from "./LaneMonitor.vue";

// The workers of a running run, side by side once the column has room (its own width, not the
// window's: the run page's right column takes some), each on the test it runs now.

const props = defineProps<{ runId: string; state: IRunState; now: number }>();

const lanes = computed(() =>
  Object.entries(props.state.lanes)
    .flatMap(([lane, testId]): { lane: number; test: ITestState }[] => {
      const test = testId === null ? undefined : props.state.tests[testId];
      return test === undefined ? [] : [{ lane: Number(lane), test }];
    })
    .sort((left, right) => left.lane - right.lane)
);
</script>

<template>
  <section aria-label="Workers" class="@container">
    <div
      v-if="lanes.length > 0"
      class="grid gap-3"
      :class="lanes.length > 1 ? '@xl:grid-cols-2' : 'max-w-xl'"
    >
      <LaneMonitor
        v-for="entry in lanes"
        :key="entry.lane"
        :run-id="runId"
        :lane="entry.lane"
        :test="entry.test"
        :now="now"
      />
    </div>
    <p v-else class="text-sm text-muted-foreground">
      Between tests: the next one starts in a moment.
    </p>
  </section>
</template>
