<script setup lang="ts">
import { CheckIcon, CopyIcon } from "@lucide/vue";
import { useClipboard } from "@vueuse/core";
import { cn } from "cn";
import type { HTMLAttributes } from "vue";

const props = defineProps<{
  text: string;
  label: string;
  class?: HTMLAttributes["class"];
}>();

const { copy, copied } = useClipboard({ copiedDuring: 1500, legacy: true });
</script>

<template>
  <button
    type="button"
    :class="
      cn(
        'inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50',
        props.class
      )
    "
    :aria-label="copied ? 'Copied' : label"
    :title="copied ? 'Copied' : label"
    @click="copy(text)"
  >
    <CheckIcon v-if="copied" class="size-3.5 text-pass" aria-hidden="true" />
    <CopyIcon v-else class="size-3.5" aria-hidden="true" />
  </button>
</template>
