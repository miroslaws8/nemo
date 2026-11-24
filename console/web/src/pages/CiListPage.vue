<script setup lang="ts">
import { useTitle } from "@vueuse/core";
import { computed } from "vue";
import CiRow from "@/components/CiRow.vue";
import CiStatusNote from "@/components/CiStatusNote.vue";
import PageBar from "@/components/PageBar.vue";
import { useClock } from "@/composables/useClock";
import { groupByDay } from "@/lib/groups";
import { ciOverview, isActiveCiStatus } from "@/state/ci";

// Every e2e pipeline of the repository (going first, then by day); the note says why the list is
// missing, empty or old.

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
</script>

<template>
  <PageBar>CI</PageBar>

  <CiStatusNote :overview="ciOverview" />
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
