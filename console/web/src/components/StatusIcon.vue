<script setup lang="ts">
import { cn } from "cn";
import type { HTMLAttributes } from "vue";
import { TONE_CLASSES } from "@/lib/status";
import type { IStatusLook } from "@/types";

const props = defineProps<{
  look: IStatusLook;
  class?: HTMLAttributes["class"];
}>();
</script>

<template>
  <span
    :class="
      cn(
        'inline-flex size-4 shrink-0',
        TONE_CLASSES[look.tone].text,
        props.class
      )
    "
    :title="look.label"
  >
    <component
      :is="look.icon"
      class="size-full"
      :class="look.live ? 'motion-safe:animate-spin' : ''"
      aria-hidden="true"
    />
    <span class="sr-only">{{ look.label }}</span>
  </span>
</template>
