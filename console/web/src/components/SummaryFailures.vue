<script setup lang="ts">
import { computed } from "vue";
import { formatDuration, plural } from "@/lib/format";
import type { IYamlLocation } from "@shared/types";
import type { IFailureGroup, ISetupMiss } from "@/types";
import StatusGlyph from "./StatusGlyph.vue";

// What failed, grouped by cause (the commonest first), each test a row that opens it in the
// Tests tab; and the tests that never ran because their setup failed.

const props = defineProps<{
  groups: IFailureGroup[];
  setupMiss: ISetupMiss;
  going: boolean;
}>();

const emit = defineEmits<{ open: [testId: string] }>();

const failedCount = computed(() =>
  props.groups.reduce((sum, group) => sum + group.tests.length, 0)
);

/** Where it failed, short: the file's name and the line (the whole path in its title). */
function placeOf(yaml: IYamlLocation): string {
  return `${yaml.file.slice(yaml.file.lastIndexOf("/") + 1)}:${yaml.line}`;
}
</script>

<template>
  <section aria-labelledby="summary-failures" class="min-w-0">
    <header class="flex items-baseline justify-between gap-3 border-b pb-2">
      <h3 id="summary-failures" class="text-sm font-semibold">What failed</h3>
      <span
        v-if="groups.length > 0"
        class="text-xs whitespace-nowrap text-faint tabular-nums"
        >{{ plural(failedCount, "test", "tests") }} ·
        {{ plural(groups.length, "cause", "causes") }}</span
      >
    </header>

    <p
      v-if="groups.length === 0"
      class="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground"
    >
      <StatusGlyph glyph="check" tone="pass" />
      {{ going ? "Nothing has failed so far." : "Nothing failed." }}
    </p>

    <div
      v-for="group in groups"
      :key="group.key"
      class="border-b border-border/60"
    >
      <div class="flex min-h-9 items-start gap-2 px-2 py-2.5">
        <StatusGlyph
          :glyph="group.setup ? 'bang' : 'cross'"
          tone="fail"
          class="mt-px"
        />
        <span class="min-w-0 flex-1">
          <code
            class="block truncate font-mono text-xs text-fail"
            :title="group.cause"
            >{{ group.cause }}</code
          >
          <code
            v-if="group.locator !== null"
            class="mt-0.5 block truncate font-mono text-xs text-faint"
            :title="group.locator"
            >{{ group.locator }}</code
          >
        </span>
        <span
          class="shrink-0 text-xs whitespace-nowrap text-muted-foreground tabular-nums"
          >{{ plural(group.tests.length, "test", "tests") }}</span
        >
      </div>
      <ul>
        <li v-for="test in group.tests" :key="test.testId">
          <button
            type="button"
            class="flex h-9 w-full items-center gap-3 pr-2 pl-7.5 text-left text-sm outline-none transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
            :title="`Open “${test.title}” in Tests`"
            @click="emit('open', test.testId)"
          >
            <span class="flex min-w-0 flex-1 items-baseline gap-2">
              <span class="max-w-full shrink-0 truncate font-medium">{{
                test.title
              }}</span>
              <span
                class="min-w-0 shrink-[100] truncate font-mono text-xs text-faint max-md:hidden"
                :title="test.file"
                >{{ test.file }}</span
              >
              <span
                v-if="test.step !== null"
                class="min-w-0 shrink-[50] truncate text-muted-foreground max-sm:hidden"
                >step: {{ test.step.title }}</span
              >
            </span>
            <span
              v-if="test.retry > 0"
              class="shrink-0 text-xs font-medium whitespace-nowrap text-flaky max-sm:hidden"
              >attempt {{ test.retry + 1 }}</span
            >
            <span
              v-if="test.yaml !== null"
              class="shrink-0 font-mono text-xs whitespace-nowrap text-faint max-lg:hidden"
              :title="`${test.yaml.file}:${test.yaml.line}`"
              >{{ placeOf(test.yaml) }}</span
            >
            <span
              class="w-14 shrink-0 text-right whitespace-nowrap text-muted-foreground tabular-nums"
              >{{ test.ms === null ? "" : formatDuration(test.ms) }}</span
            >
          </button>
        </li>
      </ul>
    </div>

    <p v-if="setupMiss.count > 0" class="px-2 py-2.5 text-sm text-faint">
      {{ setupMiss.count }} not run: their setup failed ({{
        setupMiss.setupTitles.join(", ")
      }})
    </p>
  </section>
</template>
