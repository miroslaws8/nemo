<script setup lang="ts">
import { PlusIcon, ScrollTextIcon, WifiOffIcon } from "@lucide/vue";
import { refDebounced } from "@vueuse/core";
import { computed } from "vue";
import { useRoute } from "vue-router";
import { Button } from "@/components/ui/button";
import { mayStartRuns } from "@/state/access";
import { consoleConfig } from "@/state/config";
import { openNewRun } from "@/state/dialogs";
import { connection } from "@/state/stream";
import EnvironmentStatus from "./EnvironmentStatus.vue";
import UserMenu from "./UserMenu.vue";

// The console's top bar: each environment's state, the link to the server, "New run" and who is
// signed in.

const starting = computed(() => mayStartRuns());
const route = useRoute();
const onSkills = computed(() => route.path.startsWith("/skills"));

// A short reconnect (the console restarting) is not worth a notice.
const settled = refDebounced(connection, 1500);
const notice = computed(() =>
  connection.value !== "open" && settled.value !== "open" ? settled.value : null
);
</script>

<template>
  <header
    class="flex h-14 shrink-0 items-center gap-4 border-b bg-background px-4"
  >
    <RouterLink
      to="/"
      class="flex shrink-0 items-center gap-2 rounded-md font-semibold tracking-tight outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <img src="/favicon.svg" alt="" class="size-6" />
      QA Console
    </RouterLink>

    <nav
      aria-label="Environments"
      class="flex min-w-0 items-center gap-1 overflow-x-auto border-l pl-3"
    >
      <EnvironmentStatus
        v-for="environment in consoleConfig?.environments ?? []"
        :key="environment.name"
        :environment="environment"
      />
    </nav>

    <div class="ml-auto flex shrink-0 items-center gap-4">
      <p
        v-if="notice !== null"
        role="status"
        class="flex items-center gap-1.5 text-sm"
        :class="notice === 'lost' ? 'text-fail' : 'text-muted-foreground'"
      >
        <WifiOffIcon class="size-4" aria-hidden="true" />
        {{
          notice === "lost"
            ? "The console does not answer"
            : "Reconnecting to the console…"
        }}
      </p>
      <Button
        size="sm"
        variant="ghost"
        as-child
        :class="onSkills ? 'bg-accent text-accent-foreground' : ''"
      >
        <RouterLink to="/skills" :aria-current="onSkills ? 'page' : undefined">
          <ScrollTextIcon aria-hidden="true" />
          Skills
        </RouterLink>
      </Button>
      <span :title="starting.reason ?? undefined">
        <Button size="sm" :disabled="!starting.allowed" @click="openNewRun()">
          <PlusIcon aria-hidden="true" />
          New run
        </Button>
      </span>
      <UserMenu />
    </div>
  </header>
</template>
