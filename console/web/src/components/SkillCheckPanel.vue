<script setup lang="ts">
import type { ISkillCheck, ISkillProblem } from "@shared/types";
import { computed, ref, watch } from "vue";
import { TONE_CLASSES } from "@/lib/status";
import type { ITone } from "@/types";
import CodeView from "./CodeView.vue";
import SkillDiff from "./SkillDiff.vue";
import SkillOverview from "./SkillOverview.vue";
import SkillProblems from "./SkillProblems.vue";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

// Beside a skill being made: where the console's check stands, its problems (each taking you to
// its place), and the result — the changes (a new version), a summary, the SKILL.md Hermes will
// read and, for a form, the skill.yaml it makes.

const props = defineProps<{
  status: { tone: ITone; words: string } | null;
  problems: ISkillProblem[];
  result: ISkillCheck | null;
  locate: "line" | "field";
  // The skill.yaml a form makes (null: the page shows the file itself).
  yaml: string | null;
}>();
const emit = defineEmits<{ show: [problem: ISkillProblem] }>();

const tab = ref("summary");
const yamlView = ref<InstanceType<typeof CodeView> | null>(null);
// A new version opens on its changes, once they are known.
watch(
  () => props.result?.diff !== null && props.result?.diff !== undefined,
  (hasChanges) => {
    if (hasChanges && tab.value === "summary") {
      tab.value = "changes";
    }
  },
  { immediate: true }
);

const marks = computed(() => {
  const found: Record<number, ITone> = {};
  for (const problem of props.problems) {
    if (problem.line !== null) {
      found[problem.line] =
        problem.severity === "error" ? "fail" : found[problem.line] ?? "flaky";
    }
  }
  return found;
});

/** Shows a line of the skill.yaml a form makes (its YAML tab). */
async function showLine(line: number): Promise<void> {
  tab.value = "yaml";
  await new Promise((resolve) => setTimeout(resolve, 50));
  yamlView.value?.showLine(line);
}

defineExpose({ showLine });
</script>

<template>
  <section aria-labelledby="skill-check" class="min-w-0 space-y-4">
    <h2 id="skill-check" class="text-sm font-semibold">
      What the console finds
    </h2>
    <p aria-live="polite" class="text-sm">
      <span
        v-if="status !== null"
        class="font-medium"
        :class="TONE_CLASSES[status.tone].text"
        >{{ status.words }}</span
      >
      <span v-else class="text-muted-foreground">
        Nothing to check yet: bring a skill.yaml.
      </span>
    </p>
    <SkillProblems
      v-if="problems.length > 0"
      :problems="problems"
      :locate="locate"
      @show="(problem) => emit('show', problem)"
    />

    <Tabs v-if="result !== null || yaml !== null" v-model="tab">
      <TabsList>
        <TabsTrigger v-if="result?.diff" value="changes">Changes</TabsTrigger>
        <TabsTrigger value="summary">Summary</TabsTrigger>
        <TabsTrigger value="skill-md">SKILL.md</TabsTrigger>
        <TabsTrigger v-if="yaml !== null" value="yaml">skill.yaml</TabsTrigger>
      </TabsList>
      <TabsContent v-if="result?.diff" value="changes" class="mt-4">
        <SkillDiff :lines="result.diff" />
      </TabsContent>
      <TabsContent value="summary" class="mt-4">
        <SkillOverview v-if="result?.preview" :fields="result.preview.fields" />
        <p v-else class="text-sm text-muted-foreground">
          The summary shows once it has no errors.
        </p>
      </TabsContent>
      <TabsContent value="skill-md" class="mt-4 space-y-2">
        <template v-if="result?.preview">
          <p class="text-xs text-muted-foreground">
            What Hermes will read: the base every skill shares, filled in with
            this skill.yaml.
          </p>
          <CodeView :text="result.preview.skillMd" label="SKILL.md" />
        </template>
        <p v-else class="text-sm text-muted-foreground">
          SKILL.md is written once it has no errors.
        </p>
      </TabsContent>
      <TabsContent v-if="yaml !== null" value="yaml" class="mt-4 space-y-2">
        <p class="text-xs text-muted-foreground">
          The skill.yaml the form makes: what the console checks and keeps.
        </p>
        <CodeView
          ref="yamlView"
          :text="yaml"
          label="skill.yaml"
          :marks="marks"
        />
      </TabsContent>
    </Tabs>
  </section>
</template>
