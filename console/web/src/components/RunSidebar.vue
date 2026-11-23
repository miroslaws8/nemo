<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useClock } from "@/composables/useClock";
import { groupByDay } from "@/lib/groups";
import { isActiveStatus } from "@/lib/status";
import { ciOverview, isActiveCiStatus } from "@/state/ci";
import { runs, runsLoaded } from "@/state/runs";
import { modeWords } from "@/state/session";
import CiListItem from "./CiListItem.vue";
import CiStatusNote from "./CiStatusNote.vue";
import RunListItem from "./RunListItem.vue";

// The console's runs (this Mac's, or the server's) and the CI pipelines, each list with the ones
// going first, then by day.

const route = useRoute();
const nowMs = useClock();
const tab = ref("local");

// A CI page opens the CI list, a run page the local one.
watch(
  () => route.path,
  (path) => {
    if (path.startsWith("/ci/")) {
      tab.value = "ci";
    } else if (path.startsWith("/runs/")) {
      tab.value = "local";
    }
  },
  { immediate: true }
);

const runGroups = computed(() =>
  groupByDay(
    runs.value,
    (run) => run.createdAt,
    (run) => run.status === "queued" || isActiveStatus(run.status),
    nowMs.value
  )
);

const pipelines = computed(() => ciOverview.value?.pipelines ?? []);
const ciGroups = computed(() =>
  groupByDay(
    pipelines.value,
    (pipeline) => pipeline.createdAt,
    (pipeline) => isActiveCiStatus(pipeline.status),
    nowMs.value
  )
);
</script>

<template>
  <aside class="flex h-full min-h-0 flex-col bg-background">
    <Tabs v-model="tab" class="flex min-h-0 flex-1 flex-col gap-0">
      <div class="px-3 pt-3 pb-2">
        <TabsList class="w-full">
          <TabsTrigger value="local" class="flex-1 gap-1.5">
            {{ modeWords.runsTab }}
            <span
              v-if="runsLoaded"
              class="tabular-nums text-muted-foreground"
              >{{ runs.length }}</span
            >
          </TabsTrigger>
          <TabsTrigger value="ci" class="flex-1 gap-1.5">
            CI
            <span
              v-if="pipelines.length > 0"
              class="tabular-nums text-muted-foreground"
              >{{ pipelines.length }}</span
            >
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="local" class="min-h-0 flex-1">
        <ScrollArea class="h-full">
          <nav :aria-label="modeWords.runsNav" class="space-y-5 px-2 pb-6">
            <section v-for="group in runGroups" :key="group.title">
              <h3 class="px-2 pb-1 text-xs font-medium text-muted-foreground">
                {{ group.title }}
              </h3>
              <ul class="space-y-0.5">
                <RunListItem
                  v-for="run in group.items"
                  :key="run.id"
                  :run="run"
                  :now="nowMs"
                />
              </ul>
            </section>
            <p
              v-if="runsLoaded && runs.length === 0"
              class="px-2 text-sm text-muted-foreground"
            >
              No runs yet. They show up here once you start one.
            </p>
            <div v-if="!runsLoaded" class="space-y-3 px-2 pt-1">
              <Skeleton class="h-9 w-full" />
              <Skeleton class="h-9 w-full" />
              <Skeleton class="h-9 w-4/5" />
            </div>
          </nav>
        </ScrollArea>
      </TabsContent>

      <TabsContent value="ci" class="min-h-0 flex-1">
        <ScrollArea class="h-full">
          <nav aria-label="CI pipelines" class="space-y-5 px-2 pb-6">
            <CiStatusNote
              v-if="
                ciOverview === null ||
                !ciOverview.configured ||
                ciOverview.error !== null ||
                pipelines.length === 0
              "
              :overview="ciOverview"
            />
            <section v-for="group in ciGroups" :key="group.title">
              <h3 class="px-2 pb-1 text-xs font-medium text-muted-foreground">
                {{ group.title }}
              </h3>
              <ul class="space-y-0.5">
                <CiListItem
                  v-for="pipeline in group.items"
                  :key="pipeline.number"
                  :pipeline="pipeline"
                  :now="nowMs"
                />
              </ul>
            </section>
          </nav>
        </ScrollArea>
      </TabsContent>
    </Tabs>
  </aside>
</template>
