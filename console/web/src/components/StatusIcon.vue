<script setup lang="ts">
import { cn } from "cn";
import type { HTMLAttributes } from "vue";
import StatusGlyph from "@/components/StatusGlyph.vue";
import type { IStatusLook } from "@/types";

const props = defineProps<{
  look: IStatusLook;
  class?: HTMLAttributes["class"];
}>();
</script>

<template>
  <span
    :class="cn('inline-flex size-3.5 shrink-0', props.class)"
    :title="look.label"
  >
    <StatusGlyph
      :glyph="look.glyph"
      :tone="look.tone"
      :live="look.live"
      class="size-full"
    />
    <span class="sr-only">{{ look.label }}</span>
  </span>
</template>
