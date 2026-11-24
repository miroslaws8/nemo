<script setup lang="ts">
import { MenuIcon } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { navOpen } from "@/state/dialogs";
import type { ICrumb } from "@/types";
import ConnectionNotice from "./ConnectionNotice.vue";

// A page's title bar at the top of the panel: the crumbs that lead back (links, a faint `›` after
// each), then the page's own name as its heading (the default slot; `title` is its tooltip when
// it is cut short), its actions on the right. Below `md` it also holds the button that opens the
// sidebar, and the connection notice the sidebar shows from `md` up.

withDefaults(defineProps<{ crumbs?: ICrumb[]; title?: string }>(), {
  crumbs: () => [],
  title: undefined,
});

const CRUMB_LINK =
  "min-w-0 shrink truncate rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50";
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
    <div class="flex min-w-0 flex-1 items-center gap-1.5 text-sm font-medium">
      <nav
        v-if="crumbs.length > 0"
        aria-label="Breadcrumb"
        class="flex min-w-0 shrink items-center gap-1.5"
      >
        <template v-for="crumb in crumbs" :key="crumb.to">
          <RouterLink
            :to="crumb.to"
            :class="[CRUMB_LINK, crumb.mono ? 'font-mono text-xs' : '']"
            >{{ crumb.label }}</RouterLink
          >
          <span class="shrink-0 font-normal text-faint" aria-hidden="true"
            >›</span
          >
        </template>
      </nav>
      <h1 class="min-w-0 truncate text-sm font-medium" :title="title">
        <slot />
      </h1>
    </div>
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
