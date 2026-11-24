<script setup lang="ts">
import { cn } from "cn";
import type { HTMLAttributes } from "vue";
import { TONE_CLASSES } from "@/lib/status";
import type { IGlyph, ITone } from "@/types";

// A status drawn on a 14px grid: a filled disc with a mark (done), or a ring (going, waiting).
const props = defineProps<{
  glyph: IGlyph;
  tone: ITone;
  live?: boolean;
  class?: HTMLAttributes["class"];
}>();

const MARK = "var(--background)";
</script>

<template>
  <svg
    viewBox="0 0 14 14"
    fill="none"
    aria-hidden="true"
    :class="
      cn(
        'size-3.5 shrink-0',
        TONE_CLASSES[tone].text,
        live && 'motion-safe:animate-[spin_2s_linear_infinite]',
        props.class
      )
    "
  >
    <template v-if="glyph === 'check'">
      <circle cx="7" cy="7" r="7" fill="currentColor" />
      <path
        d="M4.2 7.2l1.9 1.9 3.7-4"
        :stroke="MARK"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </template>
    <template v-else-if="glyph === 'cross'">
      <circle cx="7" cy="7" r="7" fill="currentColor" />
      <path
        d="M4.8 4.8l4.4 4.4M9.2 4.8l-4.4 4.4"
        :stroke="MARK"
        stroke-width="1.6"
        stroke-linecap="round"
      />
    </template>
    <template v-else-if="glyph === 'bang'">
      <circle cx="7" cy="7" r="7" fill="currentColor" />
      <path
        d="M7 3.8v4"
        :stroke="MARK"
        stroke-width="1.7"
        stroke-linecap="round"
      />
      <circle cx="7" cy="10.2" r="1" :fill="MARK" />
    </template>
    <template v-else>
      <circle
        cx="7"
        cy="7"
        r="6"
        stroke="currentColor"
        stroke-width="1.5"
        :stroke-dasharray="glyph === 'dashed' ? '2.2 2.2' : undefined"
      />
      <path
        v-if="glyph === 'pie'"
        d="M7 7V3a4 4 0 0 1 3.8 5.2z"
        fill="currentColor"
      />
      <rect
        v-else-if="glyph === 'square'"
        x="4.8"
        y="4.8"
        width="4.4"
        height="4.4"
        rx="1"
        fill="currentColor"
      />
      <path
        v-else-if="glyph === 'minus'"
        d="M4.6 7h4.8"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
      />
      <path
        v-else-if="glyph === 'pause'"
        d="M5.4 4.8v4.4M8.6 4.8v4.4"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
      />
    </template>
  </svg>
</template>
