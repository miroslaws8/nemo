<script setup lang="ts">
import type { ICatalogTest, IProfileInfo } from "@shared/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { ISelectionMode, ITagCount } from "@/types";
import TagPicker from "./TagPicker.vue";
import TestPicker from "./TestPicker.vue";

// The New run dialog's body for the YAML tests: all of the profile, some picked by hand, or the
// ones with given tags, with the picker beneath.

const MODES: { value: ISelectionMode; label: string }[] = [
  { value: "all", label: "All tests of the profile" },
  { value: "pick", label: "Pick tests" },
  { value: "tags", label: "By tag" },
];

defineProps<{
  environment: string;
  profile: string;
  profileInfo: IProfileInfo | undefined;
  catalog: ICatalogTest[];
  loading: boolean;
  error: string | null;
  tagCounts: ITagCount[];
  matched: number;
}>();
const mode = defineModel<ISelectionMode>("mode", { required: true });
const picked = defineModel<string[]>("picked", { required: true });
const tags = defineModel<string[]>("tags", { required: true });
const emit = defineEmits<{ reload: [] }>();

function chooseMode(value: unknown): void {
  const found = MODES.find((option) => option.value === value);
  if (found !== undefined) {
    mode.value = found.value;
  }
}
</script>

<template>
  <div class="grid min-w-0 content-start gap-3">
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      :model-value="mode"
      aria-label="Which tests"
      class="max-w-full"
      @update:model-value="chooseMode"
    >
      <ToggleGroupItem
        v-for="option in MODES"
        :key="option.value"
        :value="option.value"
        class="h-7 min-w-0 shrink px-2.5 text-xs shadow-none"
      >
        <span class="truncate">{{ option.label }}</span>
      </ToggleGroupItem>
    </ToggleGroup>

    <p v-if="mode === 'all'" class="text-sm text-muted-foreground">
      Every test of the {{ profile }} profile.
      <template v-if="profileInfo !== undefined">
        {{ profileInfo.description }}
        Tiers: {{ profileInfo.tiers.join(", ") }}.
      </template>
    </p>
    <div v-else-if="loading" class="grid gap-2" aria-busy="true">
      <p class="text-xs text-muted-foreground">
        Listing the {{ environment }} × {{ profile }} tests…
      </p>
      <Skeleton class="h-40 w-full" />
    </div>
    <div
      v-else-if="error !== null"
      class="flex flex-wrap items-center gap-3 rounded-md px-3 py-2 text-sm ring-1 ring-fail/30"
    >
      <p class="min-w-0 flex-1 text-fail">{{ error }}</p>
      <Button type="button" size="sm" variant="outline" @click="emit('reload')">
        Try again
      </Button>
    </div>
    <TestPicker v-else-if="mode === 'pick'" v-model="picked" :tests="catalog" />
    <TagPicker v-else v-model="tags" :tags="tagCounts" :matched="matched" />
  </div>
</template>
