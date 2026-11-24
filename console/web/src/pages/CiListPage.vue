<script setup lang="ts">
import { useTitle } from "@vueuse/core";
import { computed } from "vue";
import CiRow from "@/components/CiRow.vue";
import CiStatusNote from "@/components/CiStatusNote.vue";
import PageBar from "@/components/PageBar.vue";
import { useClock } from "@/composables/useClock";
import { groupByDay } from "@/lib/groups";
import { ciOverview, isActiveCiStatus } from "@/state/ci";

// Every e2e pipeline of the repository (going first, then by day), with why the list is empty or
// old above it.

useTitle("CI");
const now = useClock();

const groups = computed(() =>
  groupByDay(
    ciOverview.value?.pipelines ?? [],
    (pipeline) => pipeline.createdAt,
    (pipeline) => isActiveCiStatus(pipeline.status),
    now.value
  )
);

// The note explains a missing, failing or rate-limited list; a plain empty one has the empty state.
const showNote = computed(() => {
  const overview = ciOverview.value;
  return (
    overview === null ||
    !overview.configured ||
    overview.error !== null ||
    overview.pausedUntil !== null
  );
});
</script>

<template>
  <PageBar>
    <span>CI</span>
  </PageBar>

  <div v-if="showNote" class="border-b py-3">
    <CiStatusNote :overview="ciOverview" />
  </div>

  <p
    v-if="groups.length === 0 && !showNote"
    class="py-16 text-center text-sm text-faint"
  >
    No pipelines yet.
  </p>
  <section v-for="group in groups" :key="group.title">
    <h2
      class="sticky top-11 z-1 flex h-8 items-center gap-2 border-b bg-paper px-4 text-sm font-medium"
    >
      {{ group.title }}
      <span class="font-normal text-faint tabular-nums">{{
        group.items.length
      }}</span>
    </h2>
    <CiRow
      v-for="pipeline in group.items"
      :key="pipeline.number"
      :pipeline="pipeline"
      :now="now"
    />
  </section>
</template>
