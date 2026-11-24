<script setup lang="ts">
import { LockIcon } from "@lucide/vue";
import type { IEnvironmentInfo } from "@shared/types";
import { computed } from "vue";
import { environmentTone } from "@/lib/environment-tone";
import { isFinishedStatus, TONE_CLASSES } from "@/lib/status";
import { activeRunOn, runs } from "@/state/runs";

// One environment in the sidebar: a dot in the tone of what runs there now or how its last run
// ended, its name, a lock when it is guarded, and "running" while a run goes. It leads to the
// environment's runs.

const props = defineProps<{ environment: IEnvironmentInfo }>();

const active = computed(() => activeRunOn(props.environment.name));
const last = computed(() =>
  runs.value.find(
    (run) => run.env === props.environment.name && isFinishedStatus(run.status)
  )
);
const tone = computed(() => environmentTone(active.value, last.value));
</script>

<template>
  <RouterLink
    :to="{ path: '/', query: { env: environment.name } }"
    class="flex h-7 items-center gap-2 rounded-md px-2 text-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
    :title="environment.baseUrl"
    :aria-current="undefined"
  >
    <span
      class="size-2 shrink-0 rounded-full"
      :class="TONE_CLASSES[tone].bar"
      aria-hidden="true"
    />
    <span class="truncate">{{ environment.name }}</span>
    <LockIcon
      v-if="environment.guarded"
      class="size-3 shrink-0 text-faint"
      aria-label="Guarded: runs ask for its name first"
    />
    <span
      v-if="active !== undefined"
      class="ml-auto text-xs font-normal"
      :class="TONE_CLASSES.run.text"
      >running</span
    >
  </RouterLink>
</template>
