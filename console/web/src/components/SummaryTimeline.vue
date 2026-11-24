<script setup lang="ts">
import { computed } from "vue";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatDuration } from "@/lib/format";
import { timeTicks } from "@/lib/run-summary";
import { TEST_STATUS_LOOKS, TONE_CLASSES } from "@/lib/status";
import type { ITimelineLane } from "@/types";

// What each worker ran when: one line per worker, each test a bar in its status's tone, placed
// by its start and length on a shared time axis. Hover or focus a bar for its test.

const props = defineProps<{ lanes: ITimelineLane[]; spanMs: number }>();

const SECOND = 1000;
const MINUTE = 60 * SECOND;

/** A tick's time, as short as it reads: 0 · 500 ms · 20 s · 1 m · 1 m 30 s. */
function tickLabel(ms: number): string {
  if (ms === 0) {
    return "0";
  }
  if (ms < SECOND) {
    return `${ms} ms`;
  }
  if (ms < MINUTE) {
    return `${ms / SECOND} s`;
  }
  const minutes = Math.floor(ms / MINUTE);
  const seconds = Math.round((ms % MINUTE) / SECOND);
  return seconds === 0 ? `${minutes} m` : `${minutes} m ${seconds} s`;
}

function percent(ms: number): number {
  return props.spanMs <= 0 ? 0 : (ms / props.spanMs) * 100;
}

const ticks = computed(() =>
  timeTicks(props.spanMs).map((ms) => {
    const at = percent(ms);
    // The first label starts at its tick, one near the end ends there, the rest centre on it.
    const align =
      ms === 0 ? "" : at > 92 ? "-translate-x-full" : "-translate-x-1/2";
    return { ms, at, label: tickLabel(ms), align };
  })
);

const rows = computed(() =>
  props.lanes.map((lane) => ({
    lane: lane.lane,
    bars: lane.bars.map((bar) => ({
      ...bar,
      left: percent(bar.startMs),
      width: percent(bar.endMs - bar.startMs),
      duration: formatDuration(bar.endMs - bar.startMs),
      label: TEST_STATUS_LOOKS[bar.status].label,
      colour: TONE_CLASSES[bar.tone].bar,
    })),
  }))
);
</script>

<template>
  <section aria-labelledby="summary-timeline" class="hidden min-w-0 sm:block">
    <header class="flex items-baseline justify-between gap-3 border-b pb-2">
      <h3 id="summary-timeline" class="text-sm font-semibold">Timeline</h3>
      <span class="text-xs text-faint">each worker, test by test</span>
    </header>
    <div class="pt-3">
      <div
        v-for="row in rows"
        :key="row.lane"
        class="flex h-6 items-center gap-2"
      >
        <span class="w-6 shrink-0 font-mono text-xs text-faint"
          >w{{ row.lane + 1 }}</span
        >
        <div class="relative h-full min-w-0 flex-1">
          <Tooltip v-for="bar in row.bars" :key="bar.testId">
            <TooltipTrigger as-child>
              <button
                type="button"
                class="absolute inset-y-1 min-w-0.5 rounded-sm outline-none transition-opacity hover:opacity-75 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                :class="bar.colour"
                :style="{
                  left: `${bar.left}%`,
                  width: `max(2px, calc(${bar.width}% - 2px))`,
                }"
                :aria-label="`${bar.title}: ${bar.label.toLowerCase()}, ${
                  bar.duration
                }`"
              />
            </TooltipTrigger>
            <TooltipContent>
              <span class="font-medium tabular-nums">{{ bar.duration }}</span>
              <span class="text-muted-foreground"> · {{ bar.label }}</span>
              <span class="block">{{ bar.title }}</span>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
      <div class="flex gap-2 pt-1">
        <span class="w-6 shrink-0" />
        <div class="relative h-5 min-w-0 flex-1 border-t" aria-hidden="true">
          <span
            v-for="tick in ticks"
            :key="tick.ms"
            class="absolute top-1 text-xs whitespace-nowrap text-faint tabular-nums"
            :class="tick.align"
            :style="{ left: `${tick.at}%` }"
            >{{ tick.label }}</span
          >
        </div>
      </div>
    </div>
  </section>
</template>
