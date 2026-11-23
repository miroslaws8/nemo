<script setup lang="ts">
import { SearchIcon } from "@lucide/vue";
import type { ICatalogTest } from "@shared/types";
import { computed, ref } from "vue";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { tierOf } from "@/lib/format";

// Picks tests one by one from the catalog, grouped by tier and suite, with a filter that
// matches the title, suite, YAML file and tags.

const props = defineProps<{ tests: ICatalogTest[] }>();
const picked = defineModel<string[]>({ required: true });

const query = ref("");

const visible = computed(() => {
  const words = query.value.toLowerCase().split(/\s+/).filter(Boolean);
  return props.tests.filter((test) => {
    const text = [
      test.title,
      test.suite,
      test.file ?? "",
      tierOf(test.project),
      ...test.tags,
    ]
      .join(" ")
      .toLowerCase();
    return words.every((word) => text.includes(word));
  });
});

const groups = computed(() => {
  const byKey = new Map<
    string,
    { key: string; tier: string; suite: string; tests: ICatalogTest[] }
  >();
  for (const test of visible.value) {
    const tier = tierOf(test.project);
    const key = `${tier}\n${test.suite}`;
    const group = byKey.get(key) ?? { key, tier, suite: test.suite, tests: [] };
    group.tests.push(test);
    byKey.set(key, group);
  }
  return [...byKey.values()];
});

const pickedIds = computed(() => new Set(picked.value));

function setPicked(testId: string, on: boolean): void {
  const next = new Set(picked.value);
  if (on) {
    next.add(testId);
  } else {
    next.delete(testId);
  }
  picked.value = [...next];
}

function pickShown(): void {
  picked.value = [
    ...new Set([...picked.value, ...visible.value.map((test) => test.testId)]),
  ];
}
</script>

<template>
  <div class="min-w-0 overflow-hidden rounded-md border">
    <div class="flex items-center gap-2 border-b px-3">
      <SearchIcon
        class="size-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        v-model="query"
        placeholder="Filter by title, suite, file or tag"
        aria-label="Filter the tests"
        class="h-9 border-0 px-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
      />
    </div>
    <ScrollArea class="h-64">
      <section v-for="group in groups" :key="group.key">
        <h4
          class="sticky top-0 z-10 flex items-center gap-2 border-b bg-muted/90 px-3 py-1 text-xs backdrop-blur-sm"
        >
          <span class="rounded-sm bg-background px-1.5 py-px font-medium">{{
            group.tier
          }}</span>
          <span class="truncate text-muted-foreground">{{ group.suite }}</span>
        </h4>
        <label
          v-for="test in group.tests"
          :key="test.testId"
          class="flex cursor-pointer items-start gap-2.5 px-3 py-2 transition-colors hover:bg-accent/50"
        >
          <Checkbox
            :model-value="pickedIds.has(test.testId)"
            class="mt-0.5"
            @update:model-value="setPicked(test.testId, $event === true)"
          />
          <span class="min-w-0">
            <span class="block truncate text-sm">{{ test.title }}</span>
            <span
              v-if="test.file !== null"
              class="block truncate font-mono text-xs text-muted-foreground"
              >{{ test.file }}</span
            >
          </span>
        </label>
      </section>
      <p
        v-if="visible.length === 0"
        class="px-3 py-8 text-center text-sm text-muted-foreground"
      >
        No test matches “{{ query }}”.
      </p>
    </ScrollArea>
    <div class="flex items-center gap-1 border-t px-3 py-1.5 text-sm">
      <span class="tabular-nums text-muted-foreground"
        >{{ picked.length }} picked</span
      >
      <Button
        type="button"
        size="xs"
        variant="ghost"
        class="ml-auto"
        :disabled="visible.length === 0"
        @click="pickShown"
      >
        Pick all shown
      </Button>
      <Button
        type="button"
        size="xs"
        variant="ghost"
        :disabled="picked.length === 0"
        @click="picked = []"
      >
        Clear
      </Button>
    </div>
  </div>
</template>
