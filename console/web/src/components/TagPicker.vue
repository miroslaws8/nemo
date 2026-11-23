<script setup lang="ts">
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { plural } from "@/lib/format";
import type { ITagCount } from "@/types";

// Picks tests by their tags: a test runs when it carries any of the picked tags.

defineProps<{ tags: ITagCount[]; matched: number }>();
const chosen = defineModel<string[]>({ required: true });

function update(value: unknown): void {
  if (Array.isArray(value)) {
    chosen.value = value.filter(
      (entry): entry is string => typeof entry === "string"
    );
  }
}
</script>

<template>
  <div class="grid min-w-0 gap-2">
    <ToggleGroup
      v-if="tags.length > 0"
      type="multiple"
      variant="outline"
      size="sm"
      :spacing="2"
      :model-value="chosen"
      aria-label="Tags"
      class="w-full flex-wrap justify-start"
      @update:model-value="update"
    >
      <ToggleGroupItem
        v-for="entry in tags"
        :key="entry.tag"
        :value="entry.tag"
        class="gap-1.5 rounded-full"
      >
        {{ entry.tag }}
        <span class="tabular-nums text-muted-foreground">{{
          entry.count
        }}</span>
      </ToggleGroupItem>
    </ToggleGroup>
    <p v-else class="text-sm text-muted-foreground">
      These tests carry no tags.
    </p>
    <p v-if="chosen.length > 0" class="text-xs text-muted-foreground">
      {{ plural(matched, "test carries", "tests carry") }}
      {{ chosen.length > 1 ? "one of these tags" : "this tag" }}.
    </p>
  </div>
</template>
