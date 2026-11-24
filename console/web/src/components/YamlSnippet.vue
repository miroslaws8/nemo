<script setup lang="ts">
import { sourceSnippetSchema } from "@shared/api";
import type { ISourceSnippet, IYamlLocation } from "@shared/types";
import { cn } from "cn";
import { computed, ref, watch, type HTMLAttributes } from "vue";
import { Skeleton } from "@/components/ui/skeleton";
import { getJson, messageOf } from "@/lib/api";
import CopyButton from "./CopyButton.vue";

// The YAML around a test's step or failure, with that line marked. It brings its own surface (a
// muted, ringed box); a class given to it wins, so a box it sits in can take the ring away.

const props = defineProps<{
  // The run whose commit the file comes from (a server console tests commits).
  runId: string;
  location: IYamlLocation;
  // "fail" marks the line of a failure, "step" the line of a step.
  mark: "fail" | "step";
  class?: HTMLAttributes["class"];
}>();

const MARKS: Record<"fail" | "step", string> = {
  fail: "bg-fail/10 text-foreground",
  step: "bg-run/10 text-foreground",
};

const snippet = ref<ISourceSnippet | null>(null);
const error = ref<string | null>(null);
const where = computed(() => `${props.location.file}:${props.location.line}`);

async function load(): Promise<void> {
  const query = new URLSearchParams({
    run: props.runId,
    file: props.location.file,
    line: String(props.location.line),
  });
  try {
    snippet.value = await getJson(`/api/source?${query}`, sourceSnippetSchema);
    error.value = null;
  } catch (failure) {
    error.value = messageOf(failure);
  }
}

watch(where, load, { immediate: true });
</script>

<template>
  <figure
    :class="
      cn(
        'min-w-0 overflow-hidden rounded-md bg-muted font-mono text-xs ring-1 ring-border',
        props.class
      )
    "
  >
    <figcaption
      class="flex items-center gap-2 border-b py-1 pr-1.5 pl-3 text-muted-foreground"
    >
      <span class="truncate">{{ where }}</span>
      <CopyButton class="ml-auto" :text="where" label="Copy file:line" />
    </figcaption>
    <p v-if="error !== null" class="px-3 py-2 font-sans text-muted-foreground">
      {{ error }}
    </p>
    <div v-else-if="snippet !== null" class="overflow-x-auto py-1.5 leading-5">
      <div
        v-for="row in snippet.lines"
        :key="row.number"
        class="flex w-max min-w-full"
        :class="
          row.number === location.line ? MARKS[mark] : 'text-muted-foreground'
        "
      >
        <span
          class="w-12 shrink-0 pr-3 text-right tabular-nums text-faint select-none"
          >{{ row.number }}</span
        >
        <span class="pr-4 whitespace-pre">{{ row.text || " " }}</span>
      </div>
    </div>
    <div v-else class="space-y-1.5 px-3 py-2.5" aria-label="Loading the YAML">
      <Skeleton class="h-3 w-2/3" />
      <Skeleton class="h-3 w-1/2" />
      <Skeleton class="h-3 w-3/5" />
    </div>
  </figure>
</template>
