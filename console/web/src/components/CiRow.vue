<script setup lang="ts">
import type { ICiPipeline } from "@shared/types";
import { computed } from "vue";
import { ciCause, ciProfile } from "@/lib/ci";
import { elapsed, formatDuration, formatShortClock } from "@/lib/format";
import { ciPath } from "@/lib/paths";
import { CI_STATUS_LOOKS, TONE_CLASSES } from "@/lib/status";
import { toneOfEnvironment } from "@/state/runs";
import StatusIcon from "./StatusIcon.vue";

// One CI pipeline in a list, built like a RunRow: glyph · #number · title · branch · environment ·
// profile · duration · when it began; the cause (what started it) follows the title and is the
// row's tooltip. Below `sm` the environment goes, below `lg` the branch, profile, cause and time:
// the title stays readable. Every column template is a whole class name, so Tailwind finds it.
// The pipeline carries no commit, so the branch stands alone.

const props = defineProps<{ pipeline: ICiPipeline; now: number }>();

const duration = computed(() =>
  formatDuration(
    elapsed(props.pipeline.createdAt, props.pipeline.endedAt, props.now)
  )
);

const cause = computed(() => ciCause(props.pipeline));
const profile = computed(() => ciProfile(props.pipeline) ?? "—");
</script>

<template>
  <RouterLink
    :to="ciPath(pipeline.number)"
    :title="cause"
    class="grid h-[38px] grid-cols-[14px_auto_minmax(0,1fr)_72px] items-center gap-3 border-b border-border/60 px-4 text-sm outline-none transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset sm:grid-cols-[14px_auto_minmax(8rem,1fr)_88px_72px] lg:grid-cols-[14px_auto_minmax(8rem,1fr)_minmax(0,14rem)_88px_88px_72px_64px]"
  >
    <StatusIcon :look="CI_STATUS_LOOKS[pipeline.status]" />
    <span class="font-mono text-xs text-faint tabular-nums"
      >#{{ pipeline.number }}</span
    >
    <span class="flex min-w-0 items-baseline gap-2">
      <span class="max-w-full shrink-0 truncate font-medium">{{
        pipeline.label
      }}</span>
      <span class="truncate text-xs text-faint max-lg:hidden">{{ cause }}</span>
    </span>
    <span class="truncate font-mono text-xs text-faint max-lg:hidden">{{
      pipeline.branch ?? "—"
    }}</span>
    <span
      class="flex min-w-0 items-center gap-1.5 text-muted-foreground max-sm:hidden"
    >
      <template v-if="pipeline.env !== null">
        <span
          class="size-1.5 shrink-0 rounded-full"
          :class="TONE_CLASSES[toneOfEnvironment(pipeline.env)].bar"
          aria-hidden="true"
        />
        <span class="truncate">{{ pipeline.env }}</span>
      </template>
    </span>
    <span class="truncate text-muted-foreground max-lg:hidden">{{
      profile
    }}</span>
    <span
      class="text-right whitespace-nowrap text-muted-foreground tabular-nums"
      >{{ duration }}</span
    >
    <span
      class="text-right whitespace-nowrap text-muted-foreground tabular-nums max-lg:hidden"
      >{{ formatShortClock(pipeline.createdAt) }}</span
    >
  </RouterLink>
</template>
