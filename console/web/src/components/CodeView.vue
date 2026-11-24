<script setup lang="ts">
import { computed, ref, useId } from "vue";
import { TONE_CLASSES } from "@/lib/status";
import type { ITone } from "@/types";
import CopyButton from "./CopyButton.vue";

// A text file shown whole: its name, a copy button, numbered lines; `marks` tints lines (a
// problem's line in a skill.yaml) and showLine brings one into view. Long lines scroll sideways.

const props = defineProps<{
  text: string;
  label: string;
  marks?: Record<number, ITone>;
}>();

const id = useId();
const scroller = ref<HTMLElement | null>(null);
const lines = computed(() => props.text.replace(/\n$/, "").split("\n"));

function lineId(line: number): string {
  return `${id}-line-${line}`;
}

/** Scrolls the view to a line (1-based), in the middle of it. */
function showLine(line: number): void {
  scroller.value
    ?.querySelector(`[id="${lineId(line)}"]`)
    ?.scrollIntoView({ block: "center", behavior: "smooth" });
}

defineExpose({ showLine });
</script>

<template>
  <figure
    class="overflow-hidden rounded-md bg-muted font-mono text-xs ring-1 ring-border"
  >
    <figcaption
      class="flex h-8 items-center gap-2 border-b pr-1.5 pl-3 text-muted-foreground"
    >
      <span class="truncate">{{ label }}</span>
      <CopyButton class="ml-auto" :text="text" :label="`Copy ${label}`" />
    </figcaption>
    <div ref="scroller" class="max-h-[36rem] overflow-auto py-1.5 leading-5">
      <div
        v-for="(line, index) in lines"
        :id="lineId(index + 1)"
        :key="index"
        class="flex w-max min-w-full"
        :class="
          marks?.[index + 1] === undefined
            ? ''
            : TONE_CLASSES[marks[index + 1]].soft
        "
      >
        <span
          class="w-12 shrink-0 pr-3 text-right tabular-nums text-faint select-none"
          >{{ index + 1 }}</span
        >
        <span class="pr-4 whitespace-pre">{{ line || " " }}</span>
      </div>
    </div>
  </figure>
</template>
