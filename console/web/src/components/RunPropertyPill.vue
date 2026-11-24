<script setup lang="ts">
// One property of a new run in the New run dialog's bar: a round button that opens its menu,
// or, given `pressed`, turns an option on and off.

defineProps<{ pressed?: boolean }>();
</script>

<template>
  <button
    type="button"
    :aria-pressed="pressed"
    class="inline-flex h-7 max-w-full min-w-0 shrink-0 items-center gap-1.5 rounded-full border bg-background px-2.5 text-xs font-medium whitespace-nowrap text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-pressed:border-transparent aria-pressed:bg-accent aria-pressed:text-accent-foreground data-[state=open]:bg-muted [&_svg]:size-3.5 [&_svg]:shrink-0"
  >
    <slot />
  </button>
</template>
