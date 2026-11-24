<script setup lang="ts">
import { WifiOffIcon } from "@lucide/vue";
import { connectionNotice } from "@/state/stream";

// That the console does not answer, or that the tab is reconnecting to it. Where it shows sets
// its display (`flex` at the widths it is for), so only one copy is ever in the accessibility tree.
</script>

<template>
  <p
    v-if="connectionNotice !== null"
    role="status"
    class="items-center gap-1.5 text-xs"
    :class="connectionNotice === 'lost' ? 'text-fail' : 'text-muted-foreground'"
  >
    <WifiOffIcon class="size-3.5 shrink-0" aria-hidden="true" />
    {{
      connectionNotice === "lost"
        ? "The console does not answer"
        : "Reconnecting to the console…"
    }}
  </p>
</template>
