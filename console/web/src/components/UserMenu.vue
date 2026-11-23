<script setup lang="ts">
import { ChevronDownIcon, LogOutIcon } from "@lucide/vue";
import type { IRole } from "@shared/types";
import { computed } from "vue";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { consoleConfig } from "@/state/config";
import { me, signOut } from "@/state/session";

// Who is signed in to a server console, what their role lets them do, and "Sign out". A local
// console has nobody signed in, so it shows nothing.

const ROLE_SUMMARIES: Record<IRole, (guarded: string) => string> = {
  viewer: () => "watches runs and CI",
  runner: (guarded) => `runs tests, except on ${guarded}`,
  operator: (guarded) => `runs tests everywhere, ${guarded} too`,
};

const guardedNames = computed(
  () =>
    (consoleConfig.value?.environments ?? [])
      .filter((environment) => environment.guarded)
      .map((environment) => environment.name)
      .join(" and ") || "guarded environments"
);
</script>

<template>
  <DropdownMenu v-if="me !== null && me.email !== null">
    <DropdownMenuTrigger as-child>
      <Button variant="ghost" size="sm" class="max-w-56">
        <span class="truncate">{{ me.email }}</span>
        <ChevronDownIcon aria-hidden="true" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="w-64">
      <DropdownMenuLabel class="grid gap-0.5">
        <span class="truncate">{{ me.email }}</span>
        <span class="text-xs font-normal text-muted-foreground">
          <span class="capitalize">{{ me.role }}</span
          >: {{ ROLE_SUMMARIES[me.role](guardedNames) }}
        </span>
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem @select="signOut">
        <LogOutIcon aria-hidden="true" />
        Sign out
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
