<script setup lang="ts">
import { cn } from "cn";
import type { HTMLAttributes } from "vue";
import { TONE_CLASSES } from "@/lib/status";
import type { ITone } from "@/types";
import StatusGlyph from "./StatusGlyph.vue";

// A one-line banner: a tone's soft fill, its "!" glyph on the left, the words (they wrap on a
// phone). `alert` makes it announce itself at once (a problem that just happened).

const props = defineProps<{
  tone: ITone;
  alert?: boolean;
  class?: HTMLAttributes["class"];
}>();
</script>

<template>
  <p
    :role="alert ? 'alert' : undefined"
    :class="
      cn(
        'flex items-start gap-2 rounded-md px-3 py-2 text-sm',
        TONE_CLASSES[tone].soft,
        TONE_CLASSES[tone].text,
        props.class
      )
    "
  >
    <StatusGlyph glyph="bang" :tone="tone" class="mt-[3px]" />
    <span class="min-w-0 break-words"><slot /></span>
  </p>
</template>
