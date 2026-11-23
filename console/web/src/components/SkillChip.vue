<script setup lang="ts">
import { TONE_CLASSES } from "@/lib/status";
import type { ITone } from "@/types";

// A short fact about a skill (what it changes, where it comes from), in a tone.

defineProps<{ tone: ITone; label: string; title?: string }>();
</script>

<template>
  <span
    class="inline-flex items-center rounded-sm px-1.5 py-px text-xs font-medium whitespace-nowrap"
    :class="[TONE_CLASSES[tone].soft, TONE_CLASSES[tone].text]"
    :title="title"
    >{{ label }}</span
  >
</template>
