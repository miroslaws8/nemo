<script setup lang="ts">
import { FileUpIcon } from "@lucide/vue";
import { useDropZone, useFileDialog } from "@vueuse/core";
import { ref } from "vue";
import { Button } from "@/components/ui/button";

// Where a skill.yaml comes in: dropped on it, or chosen with the button (the keyboard's way).

const emit = defineEmits<{ file: [file: File] }>();

const zone = ref<HTMLElement | null>(null);
const { isOverDropZone } = useDropZone(zone, {
  multiple: false,
  onDrop: (files) => {
    const [file] = files ?? [];
    if (file !== undefined) {
      emit("file", file);
    }
  },
});
const { open, onChange } = useFileDialog({
  accept: ".yaml,.yml,text/yaml,text/x-yaml,application/yaml",
  multiple: false,
  reset: true,
});
onChange((files) => {
  const file = files?.item(0);
  if (file !== null && file !== undefined) {
    emit("file", file);
  }
});
</script>

<template>
  <div
    ref="zone"
    class="flex flex-col items-center justify-center gap-3 rounded-md border border-dashed px-6 py-10 text-center transition-colors"
    :class="
      isOverDropZone
        ? 'border-run bg-run/10'
        : 'border-border bg-muted/40 hover:border-ring/60'
    "
  >
    <FileUpIcon
      class="size-5"
      :class="isOverDropZone ? 'text-run' : 'text-muted-foreground'"
      aria-hidden="true"
    />
    <p class="text-sm font-medium">
      {{ isOverDropZone ? "Drop it here" : "Drop the skill's skill.yaml here" }}
    </p>
    <Button variant="outline" size="sm" @click="open()">Choose a file</Button>
  </div>
</template>
