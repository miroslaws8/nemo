<script setup lang="ts">
import { MonitorIcon, MoonIcon, SunIcon } from "@lucide/vue";
import type { Component } from "vue";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { themeChoice } from "@/state/theme";
import { THEME_CHOICES } from "@/types";
import type { IThemeChoice } from "@/types";

// The sidebar's theme picker: System, Light or Dark (state/theme.ts).

const CHOICES: Record<IThemeChoice, { label: string; icon: Component }> = {
  system: { label: "System", icon: MonitorIcon },
  light: { label: "Light", icon: SunIcon },
  dark: { label: "Dark", icon: MoonIcon },
};

function pick(value: unknown): void {
  const choice = THEME_CHOICES.find((candidate) => candidate === value);
  if (choice !== undefined) {
    themeChoice.value = choice;
  }
}
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button
        variant="ghost"
        size="icon-sm"
        class="text-muted-foreground"
        aria-label="Theme"
      >
        <component :is="CHOICES[themeChoice].icon" aria-hidden="true" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent side="top" align="start">
      <DropdownMenuRadioGroup
        :model-value="themeChoice"
        @update:model-value="pick"
      >
        <DropdownMenuRadioItem
          v-for="choice in THEME_CHOICES"
          :key="choice"
          :value="choice"
        >
          <component
            :is="CHOICES[choice].icon"
            class="size-4"
            aria-hidden="true"
          />
          {{ CHOICES[choice].label }}
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
