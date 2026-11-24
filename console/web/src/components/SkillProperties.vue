<script setup lang="ts">
import type {
  ISkillDetail,
  ISkillStoreKind,
  ISkillSummary,
} from "@shared/types";
import { computed } from "vue";
import { formatUsd, formatWhen } from "@/lib/format";
import { runPath } from "@/lib/paths";
import { originWords, SAFETY_WORDS, STORE_WORDS } from "@/lib/skills";
import { RUN_STATUS_LOOKS, TONE_CLASSES } from "@/lib/status";
import { toneOfEnvironment } from "@/state/runs";
import CopyButton from "./CopyButton.vue";
import StatusIcon from "./StatusIcon.vue";

// What a skill is, as label–value rows: its name, what it changes and spends, where it comes from
// (and which of two of a name runs), what prod runs of a stored one, who added or replaced it, its
// last check, where CI runs it and where it starts. The skill page's right column (from `lg`),
// above its tabs below that.

const props = defineProps<{
  skill: ISkillSummary;
  detail: ISkillDetail;
  now: number;
  storeKind: ISkillStoreKind;
  // Whether a version is promoted to prod (a store with versions), or the branch decides.
  channels: boolean;
}>();

const LINK =
  "rounded-sm text-run underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50";

const safety = computed(() =>
  props.skill.safety === null ? null : SAFETY_WORDS[props.skill.safety]
);
// Which of two skills of this name runs: the repo's, or the store's.
const shadowedWords = computed(() => {
  if (!props.skill.shadowed) {
    return null;
  }
  const place = STORE_WORDS[props.storeKind].place;
  return props.skill.origin === "repo"
    ? {
        label: `Shadowed by ${place}`,
        title: `${place} has a skill of this name: that one runs`,
      }
    : {
        label: "Shadowed by the repo",
        title:
          "The repo has a skill of this name on this branch: that one runs",
      };
});
const lastRun = computed(() => {
  const run = props.skill.lastRun;
  if (run === null) {
    return null;
  }
  const look = RUN_STATUS_LOOKS[run.status];
  // "Failed today at 14:02 · $0.42"; a check still going by its status alone.
  const said = [
    look.label,
    ...(run.endedAt === null ? [] : [formatWhen(run.endedAt, props.now)]),
  ].join(" ");
  return {
    id: run.id,
    look,
    words: run.usd === null ? said : `${said} · ${formatUsd(run.usd)}`,
  };
});
</script>

<template>
  <dl
    class="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-y-2.5 text-sm [&>dd]:min-w-0 [&>dd]:[overflow-wrap:anywhere] [&>dt]:text-muted-foreground"
  >
    <dt>Name</dt>
    <dd class="flex items-start gap-0.5">
      <span class="font-mono text-xs leading-5">{{ skill.name }}</span>
      <CopyButton :text="skill.name" label="Copy the name" class="-my-1" />
    </dd>

    <template v-if="safety !== null">
      <dt>Safety</dt>
      <dd class="flex items-center gap-1.5" :title="safety.hint">
        <span
          class="size-1.5 shrink-0 rounded-full"
          :class="TONE_CLASSES[safety.tone].bar"
          aria-hidden="true"
        />
        {{ safety.label }}
      </dd>
    </template>

    <template v-if="skill.aiCredits">
      <dt>AI credits</dt>
      <dd class="text-flaky">Spends them on the environment</dd>
    </template>

    <dt>Source</dt>
    <dd>
      {{ originWords(skill, storeKind) }}
      <span
        v-if="shadowedWords !== null"
        class="block text-muted-foreground"
        :title="shadowedWords.title"
        >{{ shadowedWords.label }}</span
      >
    </dd>

    <template v-if="skill.origin === 'console' && channels">
      <dt>Prod</dt>
      <dd class="tabular-nums">
        <template v-if="detail.prod !== null">
          v{{ detail.prod.version }} · {{ formatWhen(detail.prod.at, now) }}
          <span
            v-if="detail.prod.by !== null"
            class="block truncate text-muted-foreground"
            :title="detail.prod.by"
            >{{ detail.prod.by }}</span
          >
        </template>
        <span v-else class="text-muted-foreground">No version yet</span>
      </dd>
    </template>

    <template v-if="skill.updatedAt !== null">
      <dt>{{ skill.version === 1 ? "Added" : "Replaced" }}</dt>
      <dd class="tabular-nums">
        {{ formatWhen(skill.updatedAt, now) }}
        <span
          v-if="skill.updatedBy !== null"
          class="block truncate text-muted-foreground"
          :title="skill.updatedBy"
          >{{ skill.updatedBy }}</span
        >
      </dd>
    </template>

    <template v-if="lastRun !== null">
      <dt>Last check</dt>
      <dd>
        <RouterLink
          :to="runPath(lastRun.id)"
          class="inline-flex max-w-full items-start gap-1.5"
          :class="LINK"
        >
          <StatusIcon :look="lastRun.look" class="mt-0.5" aria-hidden="true" />
          <span class="min-w-0">{{ lastRun.words }}</span>
        </RouterLink>
      </dd>
    </template>

    <template v-if="skill.afterDeploys.length > 0">
      <dt>After deploys</dt>
      <dd
        class="flex flex-wrap items-center gap-x-3 gap-y-1"
        title="CI runs it after each deploy and on its schedule (agent_checks in e2e.config.yaml)"
      >
        <span
          v-for="environment in skill.afterDeploys"
          :key="environment"
          class="flex items-center gap-1.5"
        >
          <span
            class="size-1.5 shrink-0 rounded-full"
            :class="TONE_CLASSES[toneOfEnvironment(environment)].bar"
            aria-hidden="true"
          />
          {{ environment }}
        </span>
      </dd>
    </template>

    <template v-if="skill.startAt !== null">
      <dt>Starts at</dt>
      <dd class="font-mono text-xs leading-5">{{ skill.startAt }}</dd>
    </template>
  </dl>
</template>
