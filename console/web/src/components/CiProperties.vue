<script setup lang="ts">
import { ExternalLinkIcon } from "@lucide/vue";
import type { ICiPipeline, IRunRecord } from "@shared/types";
import { computed } from "vue";
import { ciCause, ciProfile } from "@/lib/ci";
import { elapsed, formatDuration, formatLabel, formatWhen } from "@/lib/format";
import { runPath } from "@/lib/paths";
import { CI_STATUS_LOOKS, RUN_STATUS_LOOKS, TONE_CLASSES } from "@/lib/status";
import { isActiveCiStatus } from "@/state/ci";
import { toneOfEnvironment } from "@/state/runs";
import StatusIcon from "./StatusIcon.vue";
import StatusPill from "./StatusPill.vue";

// What a CI pipeline is, as label–value rows like a run's: its status, what started it, where and
// what it tests, when, and the console run that follows it. The pipeline page's right column
// (from `lg`), above its steps below that.

const props = defineProps<{
  pipeline: ICiPipeline;
  // The run CI sent the console for it, its latest try.
  run: IRunRecord | undefined;
  now: number;
}>();

const LINK =
  "rounded-sm text-run underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50";

const going = computed(() => isActiveCiStatus(props.pipeline.status));
const profile = computed(() => ciProfile(props.pipeline));
const environmentDot = computed(() =>
  props.pipeline.env === null
    ? ""
    : TONE_CLASSES[toneOfEnvironment(props.pipeline.env)].bar
);
const duration = computed(() =>
  formatDuration(
    elapsed(props.pipeline.createdAt, props.pipeline.endedAt, props.now)
  )
);
</script>

<template>
  <dl
    class="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-y-2.5 text-sm [&>dd]:min-w-0 [&>dd]:[overflow-wrap:anywhere] [&>dt]:text-muted-foreground"
  >
    <dt>Status</dt>
    <dd><StatusPill :look="CI_STATUS_LOOKS[pipeline.status]" /></dd>

    <dt>Pipeline</dt>
    <dd class="flex items-baseline gap-1.5">
      <span class="shrink-0 font-mono text-xs tabular-nums"
        >#{{ pipeline.number }}</span
      >
      <span
        class="truncate font-mono text-xs text-faint"
        :title="pipeline.pattern"
        >{{ pipeline.pattern }}</span
      >
    </dd>

    <dt>Cause</dt>
    <dd>{{ ciCause(pipeline) }}</dd>

    <template v-if="profile !== null">
      <dt>Profile</dt>
      <dd>{{ profile }}</dd>
    </template>

    <template v-if="pipeline.env !== null">
      <dt>Environment</dt>
      <dd class="flex items-center gap-1.5">
        <span
          class="size-1.5 shrink-0 rounded-full"
          :class="environmentDot"
          aria-hidden="true"
        />
        <span class="truncate">{{ pipeline.env }}</span>
      </dd>
    </template>

    <template v-if="pipeline.branch !== null">
      <dt>Branch</dt>
      <dd class="truncate font-mono text-xs" :title="pipeline.branch">
        {{ pipeline.branch }}
      </dd>
    </template>

    <template v-if="pipeline.creator !== null">
      <dt>Started by</dt>
      <dd :title="pipeline.creator">{{ pipeline.creator }}</dd>
    </template>

    <dt>Started</dt>
    <dd class="tabular-nums">{{ formatWhen(pipeline.createdAt, now) }}</dd>

    <dt>{{ going ? "Running for" : "Duration" }}</dt>
    <dd class="tabular-nums">{{ duration }}</dd>

    <template v-if="run !== undefined">
      <dt>Run</dt>
      <dd class="flex items-center gap-1.5">
        <StatusIcon :look="RUN_STATUS_LOOKS[run.status]" />
        <RouterLink :to="runPath(run.id)" :class="[LINK, 'truncate']">{{
          formatLabel(run.selection.label)
        }}</RouterLink>
      </dd>
    </template>

    <dt>Bitbucket</dt>
    <dd>
      <a
        :href="pipeline.url"
        target="_blank"
        rel="noopener"
        class="inline-flex items-center gap-1"
        :class="LINK"
      >
        Pipeline #{{ pipeline.number }}
        <ExternalLinkIcon class="size-3" aria-hidden="true" />
      </a>
    </dd>
  </dl>
</template>
