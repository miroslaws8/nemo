<script setup lang="ts">
import { ChevronRightIcon } from "@lucide/vue";
import type { ITestState } from "@shared/types";
import { computed } from "vue";
import { elapsed, formatDuration, tierOf } from "@/lib/format";
import { TEST_STATUS_LOOKS } from "@/lib/status";
import StatusIcon from "./StatusIcon.vue";
import TestDetail from "./TestDetail.vue";

const props = defineProps<{
  runId: string;
  test: ITestState;
  now: number;
  expanded: boolean;
  canRetry: boolean;
  hasReport: boolean;
  filesAllowed: boolean;
}>();

const emit = defineEmits<{ toggle: []; retry: [] }>();

const duration = computed(() => {
  if (props.test.ms !== null) {
    return formatDuration(props.test.ms);
  }
  if (props.test.status === "running" && props.test.startedAt !== null) {
    return formatDuration(elapsed(props.test.startedAt, null, props.now));
  }
  return "";
});
</script>

<template>
  <li class="border-b last:border-b-0">
    <button
      type="button"
      class="flex w-full items-center gap-3 px-4 py-2.5 text-left outline-none transition-colors hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
      :aria-expanded="expanded"
      @click="emit('toggle')"
    >
      <StatusIcon :look="TEST_STATUS_LOOKS[test.status]" />
      <span class="min-w-0 flex-1">
        <span class="block truncate text-sm font-medium">{{ test.title }}</span>
        <span class="block truncate text-xs text-muted-foreground">{{
          test.suite || test.spec
        }}</span>
      </span>
      <span
        v-if="test.retry > 0"
        class="shrink-0 rounded-full bg-flaky/10 px-2 py-0.5 text-xs font-medium text-flaky"
        >attempt {{ test.retry + 1 }}</span
      >
      <span class="hidden shrink-0 text-xs text-muted-foreground sm:inline">{{
        tierOf(test.project)
      }}</span>
      <span
        class="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground"
        >{{ duration }}</span
      >
      <ChevronRightIcon
        class="size-4 shrink-0 text-muted-foreground transition-transform duration-150 ease-out"
        :class="expanded ? 'rotate-90' : ''"
        aria-hidden="true"
      />
    </button>
    <TestDetail
      v-if="expanded"
      :run-id="runId"
      :test="test"
      :now="now"
      :can-retry="canRetry"
      :has-report="hasReport"
      :files-allowed="filesAllowed"
      @retry="emit('retry')"
    />
  </li>
</template>
