<script setup lang="ts">
import { LockIcon } from "@lucide/vue";
import type { IEnvironmentInfo } from "@shared/types";
import { computed } from "vue";
import { ciTitle } from "@/lib/ci";
import { ciPath, runPath } from "@/lib/paths";
import { CI_STATUS_LOOKS, RUN_STATUS_LOOKS } from "@/lib/status";
import { activeCiOn } from "@/state/ci";
import { activeRunOn, queuedOn } from "@/state/runs";
import StatusIcon from "./StatusIcon.vue";

// One environment in the header: what runs there now from this Mac (a link to it) or that it is
// free, and a CI pipeline going on it.

const props = defineProps<{ environment: IEnvironmentInfo }>();

const active = computed(() => activeRunOn(props.environment.name));
const queued = computed(() => queuedOn(props.environment.name).length);
const ci = computed(() => activeCiOn(props.environment.name));
</script>

<template>
  <div class="flex shrink-0 items-center">
    <RouterLink
      v-if="active !== undefined"
      :to="runPath(active.id)"
      class="flex shrink-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <StatusIcon :look="RUN_STATUS_LOOKS[active.status]" class="size-3.5" />
      <span class="font-medium">{{ environment.name }}</span>
      <span class="text-muted-foreground">{{
        RUN_STATUS_LOOKS[active.status].label.toLowerCase()
      }}</span>
      <span v-if="queued > 0" class="text-xs text-muted-foreground"
        >+{{ queued }} waiting</span
      >
    </RouterLink>
    <span
      v-else
      class="flex shrink-0 items-center gap-2 px-2.5 py-1.5 text-sm text-muted-foreground"
      :title="environment.baseUrl"
    >
      <span class="size-2 rounded-full bg-idle/60" aria-hidden="true" />
      <span class="font-medium text-foreground">{{ environment.name }}</span>
      <template v-if="ci === undefined">free</template>
      <LockIcon
        v-if="environment.guarded"
        class="size-3.5"
        aria-label="Guarded: runs ask for its name first"
      />
    </span>
    <RouterLink
      v-if="ci !== undefined"
      :to="ciPath(ci.number)"
      class="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      :title="`${ciTitle(ci)} is going on ${environment.name}`"
    >
      <StatusIcon :look="CI_STATUS_LOOKS[ci.status]" class="size-3" />
      CI #{{ ci.number }}
    </RouterLink>
  </div>
</template>
