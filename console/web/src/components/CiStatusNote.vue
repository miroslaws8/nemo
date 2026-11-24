<script setup lang="ts">
import { WorkflowIcon } from "@lucide/vue";
import { computed } from "vue";
import type { ICiOverview } from "@shared/types";
import CopyButton from "@/components/CopyButton.vue";
import StatusGlyph from "@/components/StatusGlyph.vue";
import { Skeleton } from "@/components/ui/skeleton";
import { formatClock } from "@/lib/format";
import { TONE_CLASSES } from "@/lib/status";
import type { ITone } from "@/types";

// What the CI list says besides its rows: asking, not set up, an error or Bitbucket's rate limit
// (a banner above the list), or that no pipeline has run yet.

const props = defineProps<{ overview: ICiOverview | null }>();

const SETTINGS = [
  { name: "QA_CONSOLE_BITBUCKET_REPOSITORY", hint: "<workspace>/<repository>" },
  { name: "QA_CONSOLE_BITBUCKET_TOKEN", hint: "a repository access token" },
];

type INoteState = "asking" | "setup" | "paused" | "error" | "empty" | "none";

const state = computed<INoteState>(() => {
  const overview = props.overview;
  if (overview === null) {
    return "asking";
  }
  if (!overview.configured) {
    return "setup";
  }
  if (overview.pausedUntil !== null) {
    return "paused";
  }
  if (overview.error !== null) {
    return "error";
  }
  return overview.pipelines.length === 0 ? "empty" : "none";
});

const BANNER_TONES: Partial<Record<INoteState, ITone>> = {
  paused: "flaky",
  error: "fail",
};

const bannerTone = computed(() => BANNER_TONES[state.value] ?? null);

const bannerText = computed(() => {
  const overview = props.overview;
  if (overview === null) {
    return "";
  }
  if (state.value === "paused" && overview.pausedUntil !== null) {
    return `Bitbucket's rate limit: the next update comes after ${formatClock(
      overview.pausedUntil
    )}.`;
  }
  return overview.error ?? "";
});
</script>

<template>
  <div v-if="state === 'asking'" aria-busy="true">
    <Skeleton v-for="index in 3" :key="index" class="h-[38px] rounded-none" />
  </div>

  <div v-else-if="state === 'setup'" class="mx-auto w-full max-w-lg px-4 py-16">
    <div class="text-center">
      <div
        class="mx-auto mb-3 flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground"
      >
        <WorkflowIcon class="size-5" aria-hidden="true" />
      </div>
      <p class="text-sm font-medium">Connect Bitbucket pipelines</p>
      <p class="mt-1 text-sm text-muted-foreground">
        The console lists the e2e pipelines and their runs once it can reach the
        repository.
      </p>
    </div>
    <ul class="mt-6 divide-y rounded-lg ring-1 ring-border">
      <li
        v-for="setting in SETTINGS"
        :key="setting.name"
        class="flex h-10 items-center gap-2 px-3 font-mono text-xs"
      >
        <span class="min-w-0 flex-1 truncate"
          >{{ setting.name }}<span class="text-faint">=</span
          ><span class="text-faint">{{ setting.hint }}</span></span
        >
        <CopyButton
          :text="`${setting.name}=`"
          :label="`Copy ${setting.name}=`"
          class="ml-auto"
        />
      </li>
    </ul>
    <p class="mt-2 text-xs text-faint">
      Put them in this working copy's .env, then restart the console. The token
      needs Pipelines: Read and Write.
    </p>
  </div>

  <div
    v-else-if="bannerTone !== null"
    role="status"
    :class="[
      'mx-4 mt-3 flex items-center gap-2 rounded-md px-3 py-2 text-sm',
      TONE_CLASSES[bannerTone].soft,
      TONE_CLASSES[bannerTone].text,
    ]"
  >
    <StatusGlyph glyph="bang" :tone="bannerTone" />
    <span class="min-w-0">{{ bannerText }}</span>
  </div>

  <p v-else-if="state === 'empty'" class="py-16 text-center text-sm text-faint">
    No e2e pipeline has run yet.
  </p>
</template>
