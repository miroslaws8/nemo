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
  <li class="border-b border-border/60">
    <button
      type="button"
      class="flex h-9 w-full items-center gap-3 px-2 text-left text-sm outline-none transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
      :aria-expanded="expanded"
      @click="emit('toggle')"
    >
      <StatusIcon :look="TEST_STATUS_LOOKS[test.status]" />
      <span class="flex min-w-0 flex-1 items-baseline gap-2">
        <span class="truncate font-medium" :title="test.title">{{
          test.title
        }}</span>
        <span class="min-w-0 shrink-[100] truncate text-faint max-sm:hidden">{{
          test.suite || test.spec
        }}</span>
      </span>
      <span
        v-if="test.retry > 0"
        class="shrink-0 text-xs font-medium whitespace-nowrap text-flaky"
        >attempt {{ test.retry + 1 }}</span
      >
      <span class="shrink-0 text-muted-foreground max-sm:hidden">{{
        tierOf(test.project)
      }}</span>
      <span
        class="w-16 shrink-0 text-right whitespace-nowrap text-muted-foreground tabular-nums"
        >{{ duration }}</span
      >
      <ChevronRightIcon
        class="size-4 shrink-0 text-faint transition-transform duration-150 ease-out"
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
