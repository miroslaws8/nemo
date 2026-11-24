<script setup lang="ts">
import type { IRunCounts } from "@shared/types";
import { computed } from "vue";
import { COUNT_SEGMENTS, TONE_CLASSES } from "@/lib/status";

// A run's tests so far as a thin bar: passed, flaky, failed and stopped, each a share of the
// total; what is still going or waiting is the bare track.

const props = withDefaults(
  defineProps<{ counts: IRunCounts; height?: 3 | 4 }>(),
  { height: 4 }
);

const HEIGHTS: Record<3 | 4, string> = { 3: "h-[3px]", 4: "h-1" };
const BAR_KEYS = new Set(["passed", "flaky", "failed", "interrupted"]);

const segments = computed(() =>
  COUNT_SEGMENTS.filter((segment) => BAR_KEYS.has(segment.key)).map(
    (segment) => ({
      key: segment.key,
      bar: TONE_CLASSES[segment.tone].bar,
      width:
        props.counts.total === 0
          ? 0
          : (props.counts[segment.key] / props.counts.total) * 100,
    })
  )
);
</script>

<template>
  <div
    class="flex overflow-hidden rounded-full bg-border"
    :class="HEIGHTS[height]"
    aria-hidden="true"
  >
    <span
      v-for="segment in segments"
      :key="segment.key"
      class="block h-full transition-[width] duration-300"
      :class="segment.bar"
      :style="{ width: `${segment.width}%` }"
    />
  </div>
</template>
