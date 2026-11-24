<script setup lang="ts">
import type { IRunRecord } from "@shared/types";
import { useTitle } from "@vueuse/core";
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import EnvironmentStrip from "@/components/EnvironmentStrip.vue";
import PageBar from "@/components/PageBar.vue";
import RunRow from "@/components/RunRow.vue";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useClock } from "@/composables/useClock";
import { groupByDay } from "@/lib/groups";
import { isActiveStatus, isFailedRun } from "@/lib/status";
import { consoleConfig, environmentNamed } from "@/state/config";
import { runs, runsLoaded } from "@/state/runs";
import { modeWords } from "@/state/session";
import type { IRunFilter } from "@/types";

// The home page: every environment's state, then the runs (going or waiting first, then by day).
// `?env=<name>` keeps one environment, `?show=failed` the failed runs.

useTitle("Runs");
const route = useRoute();
const router = useRouter();
const now = useClock();

const FILTERS: {
  filter: IRunFilter;
  label: string;
  query: string | undefined;
}[] = [
  { filter: "all", label: "All", query: undefined },
  { filter: "failed", label: "Failed", query: "failed" },
];
const EMPTY_WORDS: Record<IRunFilter, string> = {
  all: "No runs yet.",
  failed: "No failed runs.",
};
const ACCEPTS: Record<IRunFilter, (run: IRunRecord) => boolean> = {
  all: () => true,
  failed: isFailedRun,
};
const SKELETON_ROWS = 6;

// A known environment's name, else no filter.
const environment = computed(() => {
  const name = route.query.env;
  return typeof name === "string" ? environmentNamed(name) ?? null : null;
});
const filter = computed<IRunFilter>(() =>
  route.query.show === "failed" ? "failed" : "all"
);

const environments = computed(() => {
  const chosen = environment.value;
  return chosen === null ? consoleConfig.value?.environments ?? [] : [chosen];
});

const groups = computed(() => {
  const chosen = environment.value;
  const accepts = ACCEPTS[filter.value];
  const shown = runs.value.filter(
    (run) => (chosen === null || run.env === chosen.name) && accepts(run)
  );
  return groupByDay(
    shown,
    (run) => run.createdAt,
    (run) => run.status === "queued" || isActiveStatus(run.status),
    now.value
  );
});

function chooseFilter(value: unknown): void {
  const chosen = FILTERS.find((entry) => entry.filter === value);
  if (chosen === undefined) {
    return;
  }
  void router.push({ query: { ...route.query, show: chosen.query } });
}
</script>

<template>
  <PageBar :crumbs="environment === null ? [] : [{ label: 'Runs', to: '/' }]">
    {{ environment?.name ?? "Runs" }}
    <template #actions>
      <ToggleGroup
        type="single"
        size="sm"
        :model-value="filter"
        aria-label="Show runs"
        @update:model-value="chooseFilter"
      >
        <ToggleGroupItem
          v-for="entry in FILTERS"
          :key="entry.filter"
          :value="entry.filter"
        >
          {{ entry.label }}
        </ToggleGroupItem>
      </ToggleGroup>
    </template>
  </PageBar>

  <EnvironmentStrip
    v-if="consoleConfig !== null"
    :environments="environments"
    :now="now"
  />

  <div v-if="!runsLoaded" aria-hidden="true">
    <div
      v-for="index in SKELETON_ROWS"
      :key="index"
      class="flex h-[38px] items-center gap-3 border-b border-border/60 px-4"
    >
      <Skeleton class="size-3.5 rounded-full" />
      <Skeleton class="h-3 w-2/5" />
      <Skeleton class="ml-auto h-3 w-16" />
      <Skeleton class="h-3 w-10" />
    </div>
  </div>
  <p
    v-else-if="groups.length === 0"
    class="py-16 text-center text-sm text-faint"
  >
    {{ EMPTY_WORDS[filter] }}
  </p>
  <template v-else>
    <section v-for="group in groups" :key="group.title">
      <h2
        class="sticky top-11 z-1 flex h-8 items-center gap-2 border-b bg-paper px-4 text-sm font-medium"
      >
        {{ group.title }}
        <span class="font-normal text-faint tabular-nums">{{
          group.items.length
        }}</span>
      </h2>
      <RunRow
        v-for="run in group.items"
        :key="run.id"
        :run="run"
        :now="now"
        :show-person="modeWords.showsPerson"
      />
    </section>
  </template>
</template>
