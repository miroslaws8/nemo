<script setup lang="ts">
import { PlusIcon } from "@lucide/vue";
import type { IEnvironmentInfo } from "@shared/types";
import { computed } from "vue";
import { Button } from "@/components/ui/button";
import { ciTitle } from "@/lib/ci";
import { formatLabel, formatWhen } from "@/lib/format";
import { ciPath, runPath } from "@/lib/paths";
import {
  CI_STATUS_LOOKS,
  doneCount,
  RUN_STATUS_LOOKS,
  TONE_CLASSES,
} from "@/lib/status";
import { mayActOn, refusalOf } from "@/state/access";
import { activeCiOn, latestCiOn } from "@/state/ci";
import { openNewRun } from "@/state/dialogs";
import {
  activeRunOn,
  lastFinishedOn,
  queuedOn,
  toneOfEnvironment,
} from "@/state/runs";
import DisabledReason from "./DisabledReason.vue";
import ProgressBar from "./ProgressBar.vue";
import StatusIcon from "./StatusIcon.vue";

// Each environment's state under the Runs title bar: what runs there now (with its progress) or
// how its last run ended, the CI pipeline going there or its latest, and the runs waiting. One
// environment alone (the page filtered to it) also offers "New run".

const props = defineProps<{ environments: IEnvironmentInfo[]; now: number }>();

const cells = computed(() =>
  props.environments.map((environment) => ({
    environment,
    host: new URL(environment.baseUrl).host,
    tone: toneOfEnvironment(environment.name),
    active: activeRunOn(environment.name),
    last: lastFinishedOn(environment.name),
    waiting: queuedOn(environment.name).length,
    ci: activeCiOn(environment.name) ?? latestCiOn(environment.name),
    permission: mayActOn(environment.name),
  }))
);

const single = computed(() => props.environments.length === 1);
</script>

<template>
  <!-- Cells reach 1px past their right and bottom edges, so the hairlines between them meet
       however they wrap; the strip clips the ones at its own edges. It never shrinks in the page's
       column, however long the list below. -->
  <div
    class="grid shrink-0 grid-cols-[repeat(auto-fit,minmax(240px,1fr))] overflow-hidden border-b"
  >
    <section
      v-for="cell in cells"
      :key="cell.environment.name"
      class="-mr-px -mb-px flex min-w-0 flex-col gap-1 border-r border-b px-4 py-3 text-xs"
      :aria-label="cell.environment.name"
    >
      <div class="flex items-center gap-2 text-sm font-medium">
        <span
          class="size-1.5 shrink-0 rounded-full"
          :class="TONE_CLASSES[cell.tone].bar"
          aria-hidden="true"
        />
        <span class="truncate">{{ cell.environment.name }}</span>
        <span
          v-if="cell.environment.guarded"
          class="text-xs font-normal text-faint"
          >guarded</span
        >
        <DisabledReason
          v-if="single"
          v-slot="{ describedBy }"
          class="ml-auto"
          :reason="refusalOf(cell.permission)"
        >
          <Button
            size="sm"
            variant="outline"
            :disabled="!cell.permission.allowed"
            :aria-describedby="describedBy"
            @click="openNewRun(cell.environment.name)"
          >
            <PlusIcon aria-hidden="true" />
            New run
          </Button>
        </DisabledReason>
      </div>
      <p class="truncate font-mono text-xs text-faint">{{ cell.host }}</p>

      <template v-if="cell.active !== undefined">
        <RouterLink
          :to="runPath(cell.active.id)"
          class="flex min-w-0 items-center gap-1.5 rounded-sm whitespace-nowrap text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <StatusIcon
            :look="RUN_STATUS_LOOKS[cell.active.status]"
            class="size-3"
          />
          <span class="truncate">{{
            formatLabel(cell.active.selection.label)
          }}</span>
          <span
            v-if="cell.active.progress !== null"
            class="shrink-0 tabular-nums"
            >· {{ doneCount(cell.active.progress) }} /
            {{ cell.active.progress.total }}</span
          >
        </RouterLink>
        <ProgressBar
          v-if="cell.active.progress !== null"
          :counts="cell.active.progress"
          :height="3"
          class="mt-1"
        />
      </template>
      <RouterLink
        v-else-if="cell.last !== undefined"
        :to="runPath(cell.last.id)"
        class="flex min-w-0 items-center gap-1.5 rounded-sm whitespace-nowrap text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <StatusIcon :look="RUN_STATUS_LOOKS[cell.last.status]" class="size-3" />
        <span class="truncate">{{
          formatLabel(cell.last.selection.label)
        }}</span>
        <span class="shrink-0"
          >·
          {{ formatWhen(cell.last.endedAt ?? cell.last.createdAt, now) }}</span
        >
      </RouterLink>
      <p v-else class="text-faint">No runs yet</p>

      <RouterLink
        v-if="cell.ci !== undefined"
        :to="ciPath(cell.ci.number)"
        class="flex min-w-0 items-center gap-1.5 rounded-sm whitespace-nowrap text-faint outline-none hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <StatusIcon :look="CI_STATUS_LOOKS[cell.ci.status]" class="size-3" />
        <span class="truncate">CI {{ ciTitle(cell.ci) }}</span>
        <span class="shrink-0"
          >{{ CI_STATUS_LOOKS[cell.ci.status].label.toLowerCase() }}
          {{ formatWhen(cell.ci.endedAt ?? cell.ci.createdAt, now) }}</span
        >
      </RouterLink>
      <p v-if="cell.waiting > 0" class="text-faint">
        {{ cell.waiting }} more waiting
      </p>
    </section>
  </div>
</template>
