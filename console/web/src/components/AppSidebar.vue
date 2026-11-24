<script setup lang="ts">
import { ListIcon, PlusIcon, ScrollTextIcon, WorkflowIcon } from "@lucide/vue";
import { onKeyStroke } from "@vueuse/core";
import { computed } from "vue";
import { useRoute } from "vue-router";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ISidebarNavItem } from "@/types";
import { mayStartRuns } from "@/state/access";
import { ciOverview } from "@/state/ci";
import { consoleConfig } from "@/state/config";
import { navOpen, newRunOpen, openNewRun } from "@/state/dialogs";
import { runs } from "@/state/runs";
import { modeWords } from "@/state/session";
import ConnectionNotice from "./ConnectionNotice.vue";
import SidebarEnvironment from "./SidebarEnvironment.vue";
import UserMenu from "./UserMenu.vue";

// The console's left column: "New run" (C), the places to go, each environment's state, and who
// is signed in. Below `md` the same column shows in a sheet (App.vue), which a click on any of its
// links closes (one to the page already open changes no route).

// Something already has the keyboard: a dialog, a menu or a list of options.
const OVERLAYS =
  "[role=dialog], [role=alertdialog], [role=menu], [role=listbox]";
const TEXT_FIELDS = "input, textarea, select, [contenteditable]";

const route = useRoute();
const starting = computed(() => mayStartRuns());

const navItems = computed<ISidebarNavItem[]>(() => {
  const ci = ciOverview.value;
  const items: ISidebarNavItem[] = [
    {
      label: "Runs",
      to: "/",
      icon: ListIcon,
      count: runs.value.length,
      shown: true,
      matches: (path) => path === "/" || path.startsWith("/runs/"),
    },
    {
      label: "CI",
      to: "/ci",
      icon: WorkflowIcon,
      count: ci?.pipelines.length ?? 0,
      // Only when the console reads Bitbucket.
      shown: ci?.configured === true,
      matches: (path) => path === "/ci" || path.startsWith("/ci/"),
    },
    {
      label: "Skills",
      to: "/skills",
      icon: ScrollTextIcon,
      count: null,
      shown: true,
      matches: (path) => path.startsWith("/skills"),
    },
  ];
  return items.filter((item) => item.shown);
});

function startNewRun(): void {
  navOpen.value = false;
  openNewRun();
}

function isTextField(element: Element | null): boolean {
  if (element === null) {
    return false;
  }
  return (
    element.matches(TEXT_FIELDS) ||
    (element instanceof HTMLElement && element.isContentEditable)
  );
}

// C opens "New run", unless the key means something else where it is pressed.
onKeyStroke("c", (event) => {
  const modified =
    event.metaKey || event.ctrlKey || event.altKey || event.shiftKey;
  if (
    !mayStartRuns().allowed ||
    modified ||
    newRunOpen.value ||
    document.querySelector(OVERLAYS) !== null ||
    isTextField(document.activeElement)
  ) {
    return;
  }
  event.preventDefault();
  startNewRun();
});
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-0.5">
    <RouterLink
      to="/"
      :aria-current="undefined"
      class="mb-1.5 flex items-center gap-2 rounded-md px-2 py-1.5 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      @click="navOpen = false"
    >
      <span
        class="grid size-5 shrink-0 place-items-center rounded-[5px] bg-foreground text-[11px] font-semibold text-paper"
        aria-hidden="true"
        >Q</span
      >
      <span class="flex-1 truncate text-sm font-semibold">QA Console</span>
      <span class="shrink-0 text-xs text-faint">{{ modeWords.runsTab }}</span>
    </RouterLink>

    <Tooltip :disabled="starting.allowed">
      <TooltipTrigger as-child>
        <!-- The span takes the pointer while the button is disabled, so the reason still shows. -->
        <span class="mb-2.5 block" :tabindex="starting.allowed ? undefined : 0">
          <Button
            variant="outline"
            class="w-full justify-start"
            :disabled="!starting.allowed"
            aria-keyshortcuts="c"
            @click="startNewRun"
          >
            <PlusIcon aria-hidden="true" />
            New run
            <kbd
              class="ml-auto rounded border px-1 font-sans text-xs text-faint"
              aria-hidden="true"
              >C</kbd
            >
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="right">{{ starting.reason }}</TooltipContent>
    </Tooltip>

    <nav aria-label="The console" class="grid gap-0.5">
      <RouterLink
        v-for="item in navItems"
        :key="item.label"
        :to="item.to"
        class="flex h-7 items-center gap-2 rounded-md px-2 text-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
        :class="item.matches(route.path) ? 'bg-accent text-foreground' : ''"
        :aria-current="item.matches(route.path) ? 'page' : undefined"
        @click="navOpen = false"
      >
        <component :is="item.icon" class="size-4 shrink-0" aria-hidden="true" />
        {{ item.label }}
        <span
          v-if="item.count !== null"
          class="ml-auto text-xs text-faint tabular-nums"
          >{{ item.count }}</span
        >
      </RouterLink>
    </nav>

    <template v-if="consoleConfig !== null">
      <p class="mt-4 mb-1 px-2 text-xs font-medium text-faint">Environments</p>
      <nav aria-label="Environments" class="grid gap-0.5">
        <SidebarEnvironment
          v-for="environment in consoleConfig.environments"
          :key="environment.name"
          :environment="environment"
          @click="navOpen = false"
        />
      </nav>
    </template>

    <div class="mt-auto grid gap-1 pt-2">
      <!-- Below `md` the page bar says it instead: one notice in the accessibility tree. -->
      <ConnectionNotice class="hidden px-2 md:flex" />
      <UserMenu />
    </div>
  </div>
</template>
