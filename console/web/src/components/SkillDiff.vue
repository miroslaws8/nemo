<script setup lang="ts">
import type { IDiffLine } from "@shared/types";
import { computed } from "vue";

// A new skill.yaml against the one it replaces: lines taken out and put in, with a few unchanged
// lines around each change and the long unchanged runs folded.

const CONTEXT = 3;

const props = defineProps<{ lines: IDiffLine[] }>();

type IRow = { kind: "line"; line: IDiffLine } | { kind: "fold"; count: number };

const changed = computed(() =>
  props.lines.some((line) => line.kind !== "same")
);

const rows = computed((): IRow[] => {
  const near = props.lines.map((_line, index) =>
    props.lines
      .slice(Math.max(0, index - CONTEXT), index + CONTEXT + 1)
      .some((other) => other.kind !== "same")
  );
  const found: IRow[] = [];
  let folded = 0;
  props.lines.forEach((line, index) => {
    if (near[index]) {
      if (folded > 0) {
        found.push({ kind: "fold", count: folded });
        folded = 0;
      }
      found.push({ kind: "line", line });
    } else {
      folded += 1;
    }
  });
  if (folded > 0) {
    found.push({ kind: "fold", count: folded });
  }
  return found;
});

const MARKS: Record<IDiffLine["kind"], string> = {
  same: " ",
  added: "+",
  removed: "−",
};
</script>

<template>
  <p v-if="!changed" class="text-sm text-muted-foreground">
    No changes: it is the same as the current version.
  </p>
  <figure
    v-else
    class="overflow-hidden rounded-lg border bg-card text-xs"
    aria-label="Changes against the current version"
  >
    <div class="max-h-[36rem] overflow-auto py-1.5 font-mono leading-5">
      <template v-for="(row, index) in rows" :key="index">
        <div
          v-if="row.kind === 'fold'"
          class="px-3 py-0.5 text-muted-foreground italic"
        >
          ⋯ {{ row.count }} unchanged line{{ row.count === 1 ? "" : "s" }}
        </div>
        <div
          v-else
          class="flex w-max min-w-full"
          :class="
            row.line.kind === 'added'
              ? 'bg-pass/10 text-pass'
              : row.line.kind === 'removed'
              ? 'bg-fail/10 text-fail'
              : 'text-muted-foreground'
          "
        >
          <span
            class="w-6 shrink-0 text-center select-none"
            aria-hidden="true"
            >{{ MARKS[row.line.kind] }}</span
          >
          <span class="sr-only">{{
            row.line.kind === "same" ? "" : `${row.line.kind}:`
          }}</span>
          <span class="pr-4 whitespace-pre">{{ row.line.text || " " }}</span>
        </div>
      </template>
    </div>
  </figure>
</template>
