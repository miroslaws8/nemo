<script setup lang="ts">
import type { IRunCounts } from "@shared/types";
import { computed } from "vue";
import { plural } from "@/lib/format";
import { COUNT_SEGMENTS, TONE_CLASSES } from "@/lib/status";

const props = defineProps<{ counts: IRunCounts; finished: boolean }>();

// Once the run is over, a test that was still waiting will not run any more.
const segments = computed(() =>
  COUNT_SEGMENTS.flatMap((segment) => {
    const count = props.counts[segment.key];
    const label =
      props.finished && segment.key === "queued" ? "not run" : segment.label;
    return count > 0 ? [{ ...segment, label, count }] : [];
  })
);

const summary = computed(
  () =>
    `${segments.value
      .map((segment) => `${segment.count} ${segment.label}`)
      .join(", ")} of ${plural(props.counts.total, "test", "tests")}`
);
</script>

<template>
  <div>
    <div
      class="flex h-2 gap-0.5 overflow-hidden rounded-full bg-muted"
      role="img"
      :aria-label="summary"
    >
      <div
        v-for="segment in segments"
        :key="segment.key"
        class="h-full transition-[flex-grow] duration-300 ease-out"
        :class="TONE_CLASSES[segment.tone].bar"
        :style="{ flexGrow: segment.count }"
      />
    </div>
    <ul class="mt-2.5 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm">
      <li
        v-for="segment in segments"
        :key="segment.key"
        class="flex items-center gap-1.5"
      >
        <span
          class="size-2 rounded-full"
          :class="TONE_CLASSES[segment.tone].bar"
          aria-hidden="true"
        />
        <span class="font-medium tabular-nums">{{ segment.count }}</span>
        <span class="text-muted-foreground">{{ segment.label }}</span>
      </li>
      <li class="ml-auto tabular-nums text-muted-foreground">
        {{ plural(counts.total, "test", "tests") }}
      </li>
    </ul>
  </div>
</template>
