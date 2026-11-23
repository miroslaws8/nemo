<script setup lang="ts">
import { TONE_CLASSES } from "@/lib/status";
import type { IStatusLook } from "@/types";

defineProps<{ look: IStatusLook }>();
</script>

<template>
  <span
    class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-medium"
    :class="[TONE_CLASSES[look.tone].soft, TONE_CLASSES[look.tone].text]"
  >
    <component
      :is="look.icon"
      class="size-4"
      :class="look.live ? 'motion-safe:animate-spin' : ''"
      aria-hidden="true"
    />
    {{ look.label }}
  </span>
</template>
