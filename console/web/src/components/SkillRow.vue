<script setup lang="ts">
import type { ISkillSummary } from "@shared/types";
import { computed } from "vue";
import {
  formatDay,
  formatShortClock,
  formatUsd,
  formatWhen,
} from "@/lib/format";
import { runPath, skillPath } from "@/lib/paths";
import { linkOrigin, SAFETY_WORDS } from "@/lib/skills";
import { RUN_STATUS_LOOKS, TONE_CLASSES } from "@/lib/status";
import { toneOfEnvironment } from "@/state/runs";
import SkillChips from "./SkillChips.vue";
import StatusGlyph from "./StatusGlyph.vue";
import StatusIcon from "./StatusIcon.vue";

// One skill in the list: its safety as a dot · title · name · description · its markers (where it
// comes from, what prod runs, a problem, why the console cannot run it, where CI runs it) · its
// last check. The title is the row's link and stretches over it; what has a title of its own (the
// dot, the markers, the last check, a link to its run) sits above that. Below `lg` the name and
// CI's environments go, the description below `md`, the chips below `sm`, where the last check
// also keeps only its own width: the title stays readable. Every column template is a whole class
// name, so Tailwind finds it.

const props = defineProps<{
  skill: ISkillSummary;
  branch: string | null;
  now: number;
}>();

const COLUMNS =
  "grid-cols-[6px_minmax(0,1fr)_minmax(0,auto)_auto] sm:grid-cols-[6px_minmax(8rem,1fr)_minmax(0,auto)_9rem] md:grid-cols-[6px_minmax(8rem,2fr)_minmax(0,3fr)_minmax(0,auto)_9rem] lg:grid-cols-[6px_minmax(8rem,2fr)_10rem_minmax(0,3fr)_minmax(0,auto)_9rem]";

const safety = computed(() =>
  props.skill.safety === null ? null : SAFETY_WORDS[props.skill.safety]
);

const lastRun = computed(() => {
  const run = props.skill.lastRun;
  if (run === null) {
    return null;
  }
  const look = RUN_STATUS_LOOKS[run.status];
  const usd = run.usd === null ? null : formatUsd(run.usd);
  // A check still going by its status; today's by the clock, older ones by the day.
  if (run.endedAt === null) {
    return { id: run.id, look, when: look.label, title: look.label, usd };
  }
  const day = formatDay(run.endedAt, props.now);
  return {
    id: run.id,
    look,
    when: day === "Today" ? formatShortClock(run.endedAt) : day,
    title: `${look.label} ${formatWhen(run.endedAt, props.now)}`,
    usd,
  };
});
</script>

<template>
  <div
    class="relative grid h-[38px] items-center gap-3 border-b border-border/60 px-4 text-sm transition-colors hover:bg-muted has-[a:focus-visible]:bg-muted"
    :class="COLUMNS"
  >
    <span
      class="relative z-1 size-1.5 rounded-full"
      :class="TONE_CLASSES[safety?.tone ?? 'idle'].bar"
      :title="safety?.label"
    >
      <span v-if="safety !== null" class="sr-only">{{ safety.label }}</span>
    </span>
    <RouterLink
      :to="skillPath(skill.name, linkOrigin(skill), branch)"
      class="truncate font-medium outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-ring/50 focus-visible:after:ring-inset"
      >{{ skill.title ?? skill.name }}</RouterLink
    >
    <span class="truncate font-mono text-xs text-faint max-lg:hidden">{{
      skill.name
    }}</span>
    <span class="truncate text-muted-foreground max-md:hidden">{{
      skill.description
    }}</span>

    <span
      class="relative z-1 flex min-w-0 items-center justify-end gap-2 text-xs whitespace-nowrap"
    >
      <!-- Wrapping into a line that is never shown: a chip that does not fit goes whole. -->
      <span
        class="flex h-5 min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-4 overflow-hidden max-sm:hidden"
      >
        <SkillChips :skill="skill" compact />
        <span
          v-for="environment in skill.afterDeploys"
          :key="environment"
          class="flex items-center gap-1 text-muted-foreground max-lg:hidden"
          :title="`CI runs it on ${environment} after each deploy and on its schedule (agent_checks in e2e.config.yaml)`"
        >
          <span
            class="size-1.5 shrink-0 rounded-full"
            :class="TONE_CLASSES[toneOfEnvironment(environment)].bar"
            aria-hidden="true"
          />
          {{ environment }}
        </span>
      </span>
      <span
        v-if="skill.problem !== null"
        class="inline-flex shrink-0"
        :title="skill.problem"
      >
        <StatusGlyph glyph="bang" tone="fail" />
        <span class="sr-only"
          >skill.yaml has a problem: {{ skill.problem }}</span
        >
      </span>
      <span
        v-if="skill.unavailable !== null"
        class="inline-flex shrink-0"
        :title="`The console does not run it: it ${skill.unavailable}`"
      >
        <StatusGlyph glyph="bang" tone="flaky" />
        <span class="sr-only"
          >The console does not run it: it {{ skill.unavailable }}</span
        >
      </span>
    </span>

    <RouterLink
      v-if="lastRun !== null"
      :to="runPath(lastRun.id)"
      class="relative z-1 flex min-w-0 items-center justify-end gap-1.5 justify-self-end rounded-sm text-xs whitespace-nowrap text-muted-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
      :title="lastRun.title"
    >
      <StatusIcon :look="lastRun.look" />
      <span class="truncate">{{ lastRun.when }}</span>
      <span v-if="lastRun.usd !== null" class="tabular-nums"
        >· {{ lastRun.usd }}</span
      >
    </RouterLink>
    <span v-else class="text-right text-xs whitespace-nowrap text-faint"
      >No check yet</span
    >
  </div>
</template>
