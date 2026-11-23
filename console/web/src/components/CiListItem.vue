<script setup lang="ts">
import type { ICiPipeline } from "@shared/types";
import { computed } from "vue";
import { ciCause, ciProfile, ciTitle } from "@/lib/ci";
import { elapsed, formatDuration, formatShortClock } from "@/lib/format";
import { ciPath } from "@/lib/paths";
import { CI_STATUS_LOOKS } from "@/lib/status";
import StatusIcon from "./StatusIcon.vue";

const props = defineProps<{ pipeline: ICiPipeline; now: number }>();

const duration = computed(() =>
  formatDuration(
    elapsed(props.pipeline.createdAt, props.pipeline.endedAt, props.now)
  )
);

const detail = computed(() =>
  [ciProfile(props.pipeline), ciCause(props.pipeline)]
    .filter((part) => part !== null)
    .join(", ")
);
</script>

<template>
  <li>
    <RouterLink
      :to="ciPath(pipeline.number)"
      class="flex items-start gap-2.5 rounded-md px-2 py-2 outline-none transition-colors hover:bg-accent/70 focus-visible:ring-3 focus-visible:ring-ring/50 aria-[current=page]:bg-accent"
    >
      <StatusIcon :look="CI_STATUS_LOOKS[pipeline.status]" class="mt-0.5" />
      <span class="min-w-0 flex-1">
        <span class="block truncate text-sm font-medium">{{
          ciTitle(pipeline)
        }}</span>
        <span class="block truncate text-xs text-muted-foreground">{{
          detail
        }}</span>
      </span>
      <span
        class="shrink-0 text-right text-xs leading-5 tabular-nums text-muted-foreground"
      >
        <span class="block">{{ formatShortClock(pipeline.createdAt) }}</span>
        <span class="block">{{ duration }}</span>
      </span>
    </RouterLink>
  </li>
</template>
