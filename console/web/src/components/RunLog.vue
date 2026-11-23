<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { useLogTail } from "@/composables/useLogTail";

// A run's or CI step's console output (what `pnpm exec playwright test` prints), following its end
// while the reader is at the bottom.

const props = defineProps<{
  // The log's URL, without ?offset= (lib/paths.ts).
  url: string;
  going: boolean;
  visible: boolean;
}>();

const { text, trimmed, error } = useLogTail(
  () => props.url,
  () => props.going,
  () => props.visible
);

const box = ref<HTMLElement | null>(null);
let followsEnd = true;

function onScroll(): void {
  const element = box.value;
  if (element !== null) {
    followsEnd =
      element.scrollHeight - element.scrollTop - element.clientHeight < 32;
  }
}

watch(text, async () => {
  if (!followsEnd) {
    return;
  }
  await nextTick();
  const element = box.value;
  if (element !== null) {
    element.scrollTop = element.scrollHeight;
  }
});
</script>

<template>
  <section class="overflow-hidden rounded-lg border bg-card">
    <p v-if="trimmed" class="border-b px-4 py-2 text-xs text-muted-foreground">
      Only the last 500 KB are shown.
    </p>
    <p v-if="error !== null" class="border-b px-4 py-2 text-xs text-fail">
      {{ error }}
    </p>
    <div
      ref="box"
      class="h-[28rem] overflow-auto"
      tabindex="0"
      aria-label="Run log"
      @scroll.passive="onScroll"
    >
      <pre
        v-if="text !== ''"
        class="px-4 py-3 font-mono text-xs leading-5 break-words whitespace-pre-wrap"
        >{{ text }}</pre
      >
      <p v-else class="px-4 py-10 text-center text-sm text-muted-foreground">
        {{
          going ? "Waiting for output…" : "This run wrote nothing to its log."
        }}
      </p>
    </div>
  </section>
</template>
