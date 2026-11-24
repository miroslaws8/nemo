<script setup lang="ts">
import { MenuIcon } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { navOpen } from "@/state/dialogs";
import ConnectionNotice from "./ConnectionNotice.vue";

// A page's title bar at the top of the panel: its crumbs on the left (one element each; a faint
// `›` goes between them), its actions on the right. Below `md` it also holds the button that
// opens the sidebar, and the connection notice the sidebar shows from `md` up.
</script>

<template>
  <div
    class="sticky top-0 z-10 flex h-11 shrink-0 items-center gap-2 border-b bg-background px-4"
  >
    <Button
      variant="ghost"
      size="icon-sm"
      class="-ml-1.5 md:hidden"
      aria-label="Open the navigation"
      @click="navOpen = true"
    >
      <MenuIcon aria-hidden="true" />
    </Button>
    <nav
      aria-label="Breadcrumb"
      class="flex min-w-0 flex-1 items-center gap-1.5 text-sm font-medium [&>*]:truncate [&>*+*]:before:mr-1.5 [&>*+*]:before:inline-block [&>*+*]:before:font-normal [&>*+*]:before:text-faint [&>*+*]:before:content-['›']"
    >
      <slot />
    </nav>
    <!-- From `md` up the sidebar's foot says it. -->
    <ConnectionNotice class="flex shrink-0 md:hidden" />
    <div
      v-if="$slots.actions"
      class="ml-auto flex shrink-0 items-center gap-1.5"
    >
      <slot name="actions" />
    </div>
  </div>
</template>
