<script setup lang="ts">
import { skillExampleSchema } from "@shared/api";
import type { ISkillExample } from "@shared/types";
import { DownloadIcon } from "@lucide/vue";
import { onMounted, ref } from "vue";
import { getJson } from "@/lib/api";
import { skillYamlUrl } from "@/lib/paths";

// Help beside the upload: a skill.yaml to start from, and what each field says.

const example = ref<ISkillExample | null>(null);

onMounted(async () => {
  try {
    example.value = await getJson("/api/skills/example", skillExampleSchema);
  } catch {
    example.value = null;
  }
});
</script>

<template>
  <div v-if="example !== null" class="space-y-2 text-sm">
    <a
      :href="skillYamlUrl(example.name)"
      download
      class="inline-flex items-center gap-1.5 rounded-sm text-run underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <DownloadIcon class="size-3.5" aria-hidden="true" />
      Download an example ({{ example.name }})
    </a>
    <details class="group rounded-md border bg-card">
      <summary
        class="cursor-pointer rounded-md px-3 py-2 font-medium outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        What a skill.yaml holds
      </summary>
      <dl class="grid gap-2 border-t px-3 py-3">
        <div v-for="entry in example.fields" :key="entry.field">
          <dt class="flex items-center gap-1.5">
            <code class="font-mono text-xs">{{ entry.field }}</code>
            <span v-if="entry.required" class="text-xs text-muted-foreground"
              >required</span
            >
          </dt>
          <dd class="text-muted-foreground">{{ entry.description }}</dd>
        </div>
      </dl>
    </details>
  </div>
</template>
