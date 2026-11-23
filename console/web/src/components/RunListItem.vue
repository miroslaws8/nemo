<script setup lang="ts">
import type { IRunRecord } from "@shared/types";
import { computed } from "vue";
import {
  formatLabel,
  elapsed,
  formatDuration,
  formatShortClock,
  formatUsd,
  personOf,
} from "@/lib/format";
import { runPath } from "@/lib/paths";
import { RUN_STATUS_LOOKS } from "@/lib/status";
import StatusIcon from "./StatusIcon.vue";

const props = defineProps<{ run: IRunRecord; now: number }>();

const duration = computed(() =>
  props.run.startedAt === null
    ? ""
    : formatDuration(elapsed(props.run.startedAt, props.run.endedAt, props.now))
);

// A finished run with failures says how many, next to its time.
const failures = computed(() => {
  const summary = props.run.summary;
  return summary === null ? 0 : summary.failed;
});
</script>

<template>
  <li>
    <RouterLink
      :to="runPath(run.id)"
      class="flex items-start gap-2.5 rounded-md px-2 py-2 outline-none transition-colors hover:bg-accent/70 focus-visible:ring-3 focus-visible:ring-ring/50 aria-[current=page]:bg-accent"
    >
      <StatusIcon :look="RUN_STATUS_LOOKS[run.status]" class="mt-0.5" />
      <span class="min-w-0 flex-1">
        <span class="block truncate text-sm font-medium">{{
          formatLabel(run.selection.label)
        }}</span>
        <span class="block truncate text-xs text-muted-foreground">
          <span
            v-if="run.ci !== null"
            class="mr-1 rounded-sm bg-run/10 px-1 py-px font-medium text-run"
            >CI</span
          >
          <span
            v-if="run.agent !== null"
            class="mr-1 rounded-sm bg-run/10 px-1 py-px font-medium text-run"
            >Agent</span
          >
          {{ run.env }}
          <template v-if="run.agent === null"> × {{ run.profile }}</template>
          <template v-else-if="run.agent.usage !== null">
            · {{ formatUsd(run.agent.usage.estimatedUsd) }}</template
          >
          <template v-if="run.startedBy !== null">
            by {{ personOf(run.startedBy) }}</template
          >
          <span v-if="failures > 0" class="ml-1.5 text-fail"
            >{{ failures }} failed</span
          >
        </span>
      </span>
      <span
        class="shrink-0 text-right text-xs leading-5 tabular-nums text-muted-foreground"
      >
        <span class="block">{{ formatShortClock(run.createdAt) }}</span>
        <span class="block">{{ duration }}</span>
      </span>
    </RouterLink>
  </li>
</template>
