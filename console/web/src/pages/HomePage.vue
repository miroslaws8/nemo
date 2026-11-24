<script setup lang="ts">
import { LockIcon, PlusIcon } from "@lucide/vue";
import { useTitle } from "@vueuse/core";
import { computed } from "vue";
import PageBar from "@/components/PageBar.vue";
import StatusIcon from "@/components/StatusIcon.vue";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useClock } from "@/composables/useClock";
import { formatLabel, elapsed, formatDuration, formatWhen } from "@/lib/format";
import { ciTitle } from "@/lib/ci";
import { ciPath, runPath } from "@/lib/paths";
import {
  CI_STATUS_LOOKS,
  isFinishedStatus,
  RUN_STATUS_LOOKS,
} from "@/lib/status";
import { activeCiOn, latestCiOn } from "@/state/ci";
import { consoleConfig } from "@/state/config";
import { mayActOn } from "@/state/access";
import { openNewRun } from "@/state/dialogs";
import { modeWords } from "@/state/session";
import { activeRunOn, queuedOn, runs } from "@/state/runs";

// The landing page: every environment, what runs there now or how its last run went.

useTitle("QA Console");
const now = useClock();

const rows = computed(() =>
  (consoleConfig.value?.environments ?? []).map((environment) => ({
    environment,
    host: new URL(environment.baseUrl).host,
    active: activeRunOn(environment.name),
    waiting: queuedOn(environment.name).length,
    last: runs.value.find(
      (run) => run.env === environment.name && isFinishedStatus(run.status)
    ),
    ci: activeCiOn(environment.name) ?? latestCiOn(environment.name),
  }))
);
</script>

<template>
  <PageBar>
    <span>Environments</span>
  </PageBar>

  <div class="px-6 py-5">
    <h1 class="text-2xl font-semibold tracking-tight">Environments</h1>
    <p class="mt-1 max-w-prose text-sm text-muted-foreground">
      {{ modeWords.home }}, one run at a time per environment: every run there
      uses the same QA account.
    </p>

    <ul
      v-if="consoleConfig !== null"
      class="mt-6 divide-y overflow-hidden rounded-lg border bg-card"
    >
      <li
        v-for="row in rows"
        :key="row.environment.name"
        class="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4"
      >
        <div class="w-44 min-w-0">
          <p class="flex items-center gap-1.5 font-medium">
            {{ row.environment.name }}
            <LockIcon
              v-if="row.environment.guarded"
              class="size-3.5 text-muted-foreground"
              aria-label="Guarded: runs ask for its name first"
            />
          </p>
          <p class="truncate text-xs text-muted-foreground">{{ row.host }}</p>
        </div>

        <div class="min-w-0 flex-1 text-sm">
          <RouterLink
            v-if="row.active !== undefined"
            :to="runPath(row.active.id)"
            class="group flex items-center gap-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <StatusIcon :look="RUN_STATUS_LOOKS[row.active.status]" />
            <span class="truncate font-medium group-hover:underline">{{
              formatLabel(row.active.selection.label)
            }}</span>
            <span
              v-if="row.active.startedAt !== null"
              class="shrink-0 tabular-nums text-muted-foreground"
              >{{
                formatDuration(elapsed(row.active.startedAt, null, now))
              }}</span
            >
          </RouterLink>
          <RouterLink
            v-else-if="row.last !== undefined"
            :to="runPath(row.last.id)"
            class="group flex items-center gap-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <StatusIcon :look="RUN_STATUS_LOOKS[row.last.status]" />
            <span class="truncate group-hover:underline">{{
              formatLabel(row.last.selection.label)
            }}</span>
            <span class="shrink-0 text-muted-foreground"
              >{{ RUN_STATUS_LOOKS[row.last.status].label }}
              {{
                formatWhen(row.last.endedAt ?? row.last.createdAt, now)
              }}</span
            >
          </RouterLink>
          <p v-else class="text-muted-foreground">No runs yet.</p>
          <p v-if="row.waiting > 0" class="mt-1 text-xs text-muted-foreground">
            {{ row.waiting }} more waiting
          </p>
          <RouterLink
            v-if="row.ci !== undefined"
            :to="ciPath(row.ci.number)"
            class="group mt-1.5 flex items-center gap-2 rounded-sm text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <StatusIcon
              :look="CI_STATUS_LOOKS[row.ci.status]"
              class="size-3.5"
            />
            <span class="group-hover:underline">CI {{ ciTitle(row.ci) }}</span>
            {{ CI_STATUS_LOOKS[row.ci.status].label.toLowerCase() }}
            {{ formatWhen(row.ci.endedAt ?? row.ci.createdAt, now) }}
          </RouterLink>
        </div>

        <Button
          size="sm"
          variant="outline"
          :disabled="!mayActOn(row.environment.name).allowed"
          :title="mayActOn(row.environment.name).reason ?? undefined"
          @click="openNewRun(row.environment.name)"
        >
          <PlusIcon aria-hidden="true" />
          New run
        </Button>
      </li>
    </ul>

    <div v-else class="mt-6 space-y-3">
      <Skeleton class="h-16 w-full" />
      <Skeleton class="h-16 w-full" />
      <Skeleton class="h-16 w-full" />
    </div>
  </div>
</template>
