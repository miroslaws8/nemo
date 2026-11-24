<script setup lang="ts">
import type { IRunRecord } from "@shared/types";
import { computed } from "vue";
import {
  elapsed,
  formatDuration,
  formatLabel,
  formatUsd,
  personOf,
} from "@/lib/format";
import { runPath } from "@/lib/paths";
import {
  doneCount,
  isActiveStatus,
  RUN_STATUS_LOOKS,
  TONE_CLASSES,
} from "@/lib/status";
import { toneOfEnvironment } from "@/state/runs";
import ProgressBar from "./ProgressBar.vue";
import StatusIcon from "./StatusIcon.vue";

// One run in a list: glyph · label · its markers · environment · profile · duration · who started
// it (a server console only: a local one has no `startedBy`). Below `lg` the profile, the person,
// the tags and the mini bar go, and "waiting for" below `sm`: the label stays readable. From `sm`
// up the label keeps 8rem; the markers take what is left and clip, never wrapping or pushing the
// row wider than the page (a phone has no room for the floor). The duration's track holds
// "59 m 59 s". Every column template is a whole class name, so Tailwind finds it.

const props = defineProps<{
  run: IRunRecord;
  now: number;
  showPerson: boolean;
}>();

const COLUMNS = {
  withPerson:
    "grid-cols-[14px_minmax(0,1fr)_minmax(0,auto)_88px_72px] sm:grid-cols-[14px_minmax(8rem,1fr)_minmax(0,auto)_88px_72px] lg:grid-cols-[14px_minmax(8rem,1fr)_minmax(0,auto)_88px_88px_72px_56px]",
  withoutPerson:
    "grid-cols-[14px_minmax(0,1fr)_minmax(0,auto)_88px_72px] sm:grid-cols-[14px_minmax(8rem,1fr)_minmax(0,auto)_88px_72px] lg:grid-cols-[14px_minmax(8rem,1fr)_minmax(0,auto)_88px_88px_72px]",
} as const;

// The outlined tags of a run, in this order.
const TAGS: { label: string; marks: (run: IRunRecord) => boolean }[] = [
  { label: "Author", marks: (run) => run.author !== null },
  { label: "Agent", marks: (run) => run.agent !== null },
  { label: "CI", marks: (run) => run.ci !== null },
];

const tags = computed(() =>
  TAGS.filter((tag) => tag.marks(props.run)).map((tag) => tag.label)
);

// Counts while the run goes (null once it ended, or on a console too old to send them).
const progress = computed(() =>
  isActiveStatus(props.run.status) ? props.run.progress : null
);

const failures = computed(() => {
  const counts = props.run.summary ?? props.run.progress;
  return counts === null ? 0 : counts.failed;
});

const usage = computed(() => {
  const agentUsage = props.run.agent?.usage ?? null;
  return agentUsage === null ? null : formatUsd(agentUsage.estimatedUsd);
});

const duration = computed(() =>
  props.run.startedAt === null
    ? ""
    : formatDuration(elapsed(props.run.startedAt, props.run.endedAt, props.now))
);

const person = computed(() =>
  props.run.startedBy === null ? null : personOf(props.run.startedBy)
);
</script>

<template>
  <RouterLink
    :to="runPath(run.id)"
    class="grid h-[38px] items-center gap-3 border-b border-border/60 px-4 text-sm outline-none transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
    :class="showPerson ? COLUMNS.withPerson : COLUMNS.withoutPerson"
  >
    <StatusIcon :look="RUN_STATUS_LOOKS[run.status]" />
    <span class="truncate font-medium">{{
      formatLabel(run.selection.label)
    }}</span>

    <span
      class="flex min-w-0 items-center justify-end gap-1.5 overflow-hidden text-xs whitespace-nowrap"
    >
      <span
        v-for="tag in tags"
        :key="tag"
        class="rounded-full border px-1.5 text-xs font-medium text-muted-foreground max-lg:hidden"
        >{{ tag }}</span
      >
      <template v-if="progress !== null">
        <ProgressBar :counts="progress" class="w-[70px] max-lg:hidden" />
        <span class="text-faint tabular-nums"
          >{{ doneCount(progress) }}/{{ progress.total }}</span
        >
      </template>
      <span
        v-if="failures > 0"
        class="font-medium tabular-nums"
        :class="TONE_CLASSES.fail.text"
        >{{ failures }} failed</span
      >
      <span v-if="usage !== null" class="text-faint tabular-nums">{{
        usage
      }}</span>
      <span v-if="run.status === 'queued'" class="text-faint max-sm:hidden"
        >waiting for {{ run.env }}</span
      >
    </span>

    <span class="flex min-w-0 items-center gap-1.5 text-muted-foreground">
      <span
        class="size-1.5 shrink-0 rounded-full"
        :class="TONE_CLASSES[toneOfEnvironment(run.env)].bar"
        aria-hidden="true"
      />
      <span class="truncate">{{ run.env }}</span>
    </span>
    <span class="truncate text-muted-foreground max-lg:hidden">{{
      run.agent === null ? run.profile : "—"
    }}</span>
    <span
      class="text-right whitespace-nowrap text-muted-foreground tabular-nums"
      >{{ duration }}</span
    >
    <span v-if="showPerson" class="flex justify-end max-lg:hidden">
      <span v-if="run.ci !== null" class="text-xs text-faint">pipeline</span>
      <span
        v-else-if="person !== null"
        class="grid size-5 place-items-center rounded-full bg-muted text-xs font-semibold text-foreground uppercase ring-1 ring-border"
        :title="person"
        >{{ person.charAt(0) }}</span
      >
    </span>
  </RouterLink>
</template>
