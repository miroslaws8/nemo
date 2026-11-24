<script setup lang="ts">
import type { IRunRecord } from "@shared/types";
import { computed } from "vue";
import {
  elapsed,
  formatDuration,
  formatLabel,
  formatTokens,
  formatUsd,
  formatWhen,
} from "@/lib/format";
import { ciPath, commitUrl, runPath, skillPath } from "@/lib/paths";
import { runKindOf } from "@/lib/run-facts";
import { STORE_WORDS } from "@/lib/skills";
import { isActiveStatus, RUN_STATUS_LOOKS, TONE_CLASSES } from "@/lib/status";
import { consoleConfig } from "@/state/config";
import { runWithId, toneOfEnvironment } from "@/state/runs";
import { modeWords } from "@/state/session";
import type { IRunKindChoice } from "@/types";
import CopyButton from "./CopyButton.vue";
import StatusPill from "./StatusPill.vue";

// What a run is, as label–value rows: its status, where and what it ran, when, from which
// commit and by whom. The run page's right column (from `lg`), above its tabs below that.

const props = defineProps<{ run: IRunRecord; now: number }>();

const LINK =
  "rounded-sm text-run underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50";

// An agent check runs a skill, not a profile's tests; the other kinds run with a profile.
const SHOWS_PROFILE: Record<IRunKindChoice, boolean> = {
  tests: true,
  agent: false,
  author: true,
};

const look = computed(() => RUN_STATUS_LOOKS[props.run.status]);
const going = computed(() => isActiveStatus(props.run.status));
const showsProfile = computed(() => SHOWS_PROFILE[runKindOf(props.run)]);
const environmentDot = computed(
  () => TONE_CLASSES[toneOfEnvironment(props.run.env)].bar
);
// The commit a server console tested, linked to its page where the repository has one.
const commit = computed(() => {
  const sha = props.run.sha;
  return sha === null
    ? null
    : {
        short: sha.slice(0, 7),
        url: commitUrl(consoleConfig.value?.commitUrl ?? null, sha),
      };
});
// An agent check: its model by name, and what it spent once over.
const agent = computed(() => {
  const check = props.run.agent;
  if (check === null) {
    return null;
  }
  const model =
    consoleConfig.value?.agents.models.find((known) => known.id === check.model)
      ?.label ?? check.model;
  const usage = check.usage;
  return {
    model,
    spent:
      usage === null
        ? null
        : `≈ ${formatUsd(usage.estimatedUsd)} · ${formatTokens(
            usage.inputTokens + usage.outputTokens
          )} tokens`,
  };
});
const parent = computed(() =>
  props.run.parentId === null ? undefined : runWithId(props.run.parentId)
);
const duration = computed(() =>
  props.run.startedAt === null
    ? null
    : formatDuration(elapsed(props.run.startedAt, props.run.endedAt, props.now))
);
// Where a check's stored skill came from, in words: this console's, or the skill store's.
const storePlace = computed(
  () => STORE_WORDS[consoleConfig.value?.skillStore.kind ?? "console"].place
);
</script>

<template>
  <dl
    class="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-y-2.5 text-sm [&>dd]:min-w-0 [&>dd]:[overflow-wrap:anywhere] [&>dt]:text-muted-foreground"
  >
    <dt>Status</dt>
    <dd><StatusPill :look="look" /></dd>

    <dt>Environment</dt>
    <dd class="flex items-center gap-1.5">
      <span
        class="size-1.5 shrink-0 rounded-full"
        :class="environmentDot"
        aria-hidden="true"
      />
      <span class="truncate">{{ run.env }}</span>
    </dd>

    <template v-if="showsProfile">
      <dt>Profile</dt>
      <dd>{{ run.profile }}</dd>
    </template>

    <template v-if="agent !== null">
      <dt>Agent</dt>
      <dd :title="agent.model">{{ agent.model }}</dd>
    </template>
    <template v-if="run.agent !== null">
      <dt>Skill</dt>
      <dd>
        <RouterLink
          :to="
            skillPath(
              run.agent.skill,
              run.agent.skillOrigin === 'console' ? 'console' : null,
              run.ref
            )
          "
          :class="LINK"
          >{{ run.agent.skill }}</RouterLink
        >
        <span class="text-muted-foreground">
          ·
          {{
            run.agent.skillOrigin === "console"
              ? `${storePlace}'s v${run.agent.skillVersion ?? "?"}`
              : "from the repo"
          }}</span
        >
      </dd>
    </template>
    <template v-if="agent?.spent">
      <dt>Spent</dt>
      <dd class="tabular-nums" :title="agent.spent">{{ agent.spent }}</dd>
    </template>

    <dt>{{ run.startedAt === null ? "Queued" : "Started" }}</dt>
    <dd class="tabular-nums">
      {{ formatWhen(run.startedAt ?? run.createdAt, now) }}
    </dd>

    <template v-if="duration !== null">
      <dt>{{ going ? "Running for" : "Duration" }}</dt>
      <dd class="tabular-nums">{{ duration }}</dd>
    </template>

    <template v-if="run.parentId !== null">
      <dt>Retry of</dt>
      <dd>
        <RouterLink :to="runPath(run.parentId)" :class="LINK">{{
          parent === undefined
            ? run.parentId
            : formatLabel(parent.selection.label)
        }}</RouterLink>
      </dd>
    </template>

    <template v-if="run.skipNeeds">
      <dt>Needs</dt>
      <dd title="Skipped the tiers its tests need">Skipped</dd>
    </template>

    <template v-if="commit !== null">
      <dt>Commit</dt>
      <dd class="flex items-baseline gap-1.5">
        <span v-if="run.ref !== null" class="truncate" :title="run.ref">{{
          run.ref
        }}</span>
        <a
          v-if="commit.url !== null"
          :href="commit.url"
          target="_blank"
          rel="noopener"
          class="shrink-0 font-mono text-xs"
          :class="LINK"
          >{{ commit.short }}</a
        >
        <span v-else class="shrink-0 font-mono text-xs text-muted-foreground">{{
          commit.short
        }}</span>
      </dd>
    </template>

    <template v-if="run.agent?.queuedBy">
      <dt>Queued by</dt>
      <dd>
        <RouterLink :to="ciPath(run.agent.queuedBy.number)" :class="LINK"
          >{{ run.agent.queuedBy.label }} pipeline #{{
            run.agent.queuedBy.number
          }}</RouterLink
        >
      </dd>
    </template>

    <template v-if="modeWords.showsPerson && run.startedBy !== null">
      <dt>Started by</dt>
      <dd :title="run.startedBy">{{ run.startedBy }}</dd>
    </template>
    <template v-if="modeWords.showsPerson && run.stoppedBy !== null">
      <dt>Stopped by</dt>
      <dd :title="run.stoppedBy">{{ run.stoppedBy }}</dd>
    </template>

    <dt>Run id</dt>
    <dd class="flex items-center gap-0.5">
      <span class="truncate font-mono text-xs" :title="run.id">{{
        run.id
      }}</span>
      <CopyButton :text="run.id" label="Copy the run id" class="-my-1" />
    </dd>
  </dl>
</template>
