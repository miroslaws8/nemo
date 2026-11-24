<script setup lang="ts">
import { WifiOffIcon } from "@lucide/vue";
import { computed } from "vue";
import { connectionNotice } from "@/state/stream";

// That the console does not answer, or that the tab is reconnecting to it. Where it shows sets
// its display (`flex` at the widths it is for), so only one copy is ever in the accessibility tree.
// Below `sm` (a phone's title bar) it keeps only its icon; the words stay for screen readers and
// as its tooltip.

const words = computed(() =>
  connectionNotice.value === "lost"
    ? "The console does not answer"
    : "Reconnecting to the console…"
);
</script>

<template>
  <p
    v-if="connectionNotice !== null"
    role="status"
    class="items-center gap-1.5 text-xs"
    :class="connectionNotice === 'lost' ? 'text-fail' : 'text-muted-foreground'"
    :title="words"
  >
    <WifiOffIcon class="size-3.5 shrink-0" aria-hidden="true" />
    <span class="max-sm:sr-only">{{ words }}</span>
  </p>
</template>
