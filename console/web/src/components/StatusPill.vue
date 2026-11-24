<script setup lang="ts">
import StatusGlyph from "@/components/StatusGlyph.vue";
import type { IStatusLook } from "@/types";

defineProps<{ look: IStatusLook }>();
</script>

<template>
  <span class="inline-flex items-center gap-1.5 text-sm font-medium">
    <StatusGlyph :glyph="look.glyph" :tone="look.tone" :live="look.live" />
    <span class="text-foreground">{{ look.label }}</span>
  </span>
</template>
