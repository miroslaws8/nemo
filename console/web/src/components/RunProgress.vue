<script setup lang="ts">
import type { IRunCounts } from "@shared/types";
import { computed } from "vue";
import { plural } from "@/lib/format";
import { COUNT_SEGMENTS, TEST_STATUS_LOOKS } from "@/lib/status";
import ProgressBar from "./ProgressBar.vue";
import StatusGlyph from "./StatusGlyph.vue";

// A run's tests so far: the bar, then each count with its glyph on one line, the total last.

const props = defineProps<{ counts: IRunCounts; finished: boolean }>();

// Once the run is over, a test that was still waiting will not run any more. Every count is a
// test status too, so it takes that status's glyph.
const segments = computed(() =>
  COUNT_SEGMENTS.flatMap((segment) => {
    const count = props.counts[segment.key];
    const label =
      props.finished && segment.key === "queued" ? "not run" : segment.label;
    return count > 0
      ? [
          {
            key: segment.key,
            label,
            count,
            look: TEST_STATUS_LOOKS[segment.key],
          },
        ]
      : [];
  })
);
</script>

<template>
  <section aria-label="Progress" class="space-y-2.5">
    <ProgressBar :counts="counts" :height="4" />
    <ul
      class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm tabular-nums"
    >
      <li
        v-for="segment in segments"
        :key="segment.key"
        class="flex items-center gap-1.5"
      >
        <StatusGlyph
          :glyph="segment.look.glyph"
          :tone="segment.look.tone"
          :live="segment.look.live"
        />
        <span class="font-medium">{{ segment.count }}</span>
        <span class="text-muted-foreground">{{ segment.label }}</span>
      </li>
      <li class="ml-auto text-faint">
        {{ plural(counts.total, "test", "tests") }}
      </li>
    </ul>
  </section>
</template>
