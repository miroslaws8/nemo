<script setup lang="ts">
import { SKILL_MAX_BYTES } from "@shared/api";
import type { ISkillProblem } from "@shared/types";
import { useTitle } from "@vueuse/core";
import { computed, nextTick, ref, useId } from "vue";
import CodeView from "@/components/CodeView.vue";
import NoteBanner from "@/components/NoteBanner.vue";
import PageBar from "@/components/PageBar.vue";
import PermissionNote from "@/components/PermissionNote.vue";
import SkillCheckPanel from "@/components/SkillCheckPanel.vue";
import SkillDropZone from "@/components/SkillDropZone.vue";
import SkillFieldsHelp from "@/components/SkillFieldsHelp.vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useSkillEditor } from "@/composables/useSkillEditor";
import { newSkillPath, skillPath, skillsPath } from "@/lib/paths";
import { skillNameHint } from "@/lib/skills";
import type { ICrumb, ITone } from "@/types";

// A skill.yaml becomes a skill (`name` null), or a skill's new version: dropped or pasted, checked
// by the console at every pause (its problems, what Hermes will read, the changes), then added or
// saved in one click — the console writes the rest (SKILL.md included). Nothing is left to run by
// hand. Leaving with a file that is not saved asks first.

const props = defineProps<{ name: string | null }>();

const ids = { name: useId(), text: useId() };
const text = ref("");
const fileName = ref<string | null>(null);
const skillName = ref(props.name ?? "");
// The text is open for typing (pasted, or edited); else it shows with its problems' lines.
const typing = ref(false);
const fileProblem = ref<string | null>(null);
const sourceView = ref<InstanceType<typeof CodeView> | null>(null);

useTitle(
  computed(() =>
    props.name !== null
      ? `New version of ${props.name} · Skills · QA Console`
      : "Add a skill · Skills · QA Console"
  )
);

const {
  editing,
  replacedOrigin,
  current,
  currentError,
  result,
  problems,
  status,
  canSave,
  saveLabel,
  happens,
  save,
} = useSkillEditor({
  replacing: () => props.name,
  name: () => skillName.value,
  yaml: () => text.value,
  unsaved: () => text.value.trim() !== "",
});

// The lines of the file with a problem: an error's line reads as one.
const marks = computed(() => {
  const found: Record<number, ITone> = {};
  for (const problem of problems.value) {
    if (problem.line !== null) {
      found[problem.line] =
        problem.severity === "error" ? "fail" : found[problem.line] ?? "flaky";
    }
  }
  return found;
});

const nameHint = computed(() => skillNameHint(skillName.value));

// Back to the list, then to New skill or to the skill a new version replaces.
const crumbs = computed((): ICrumb[] => [
  { label: "Skills", to: skillsPath() },
  props.name === null
    ? { label: "New skill", to: newSkillPath() }
    : {
        label: props.name,
        to: skillPath(props.name, replacedOrigin.value),
        mono: true,
      },
]);

const cancelTo = computed(() =>
  props.name === null
    ? skillsPath()
    : skillPath(props.name, replacedOrigin.value)
);

// skill.yaml, qa-x.yaml or qa-x.skill.yaml: the name it suggests ("" for skill.yaml).
function nameFromFile(file: string): string {
  const base = file.replace(/\.(skill\.)?ya?ml$/i, "");
  return base === "skill" ? "" : base;
}

async function takeFile(file: File): Promise<void> {
  fileProblem.value = null;
  if (file.size > SKILL_MAX_BYTES) {
    fileProblem.value = `${file.name} is ${Math.ceil(
      file.size / 1024
    )} KB: a skill.yaml takes ${SKILL_MAX_BYTES / 1024} KB at most.`;
    return;
  }
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(
      await file.arrayBuffer()
    );
  } catch {
    fileProblem.value = `${file.name} is not UTF-8 text, which a skill.yaml is.`;
    return;
  }
  text.value = decoded.replace(/^﻿/, "");
  fileName.value = file.name;
  typing.value = false;
  if (props.name === null && skillName.value.trim() === "") {
    skillName.value = nameFromFile(file.name);
  }
}

function startOver(): void {
  text.value = "";
  fileName.value = null;
  typing.value = false;
  fileProblem.value = null;
}

async function showProblem(problem: ISkillProblem): Promise<void> {
  if (problem.line === null) {
    return;
  }
  typing.value = false;
  await nextTick();
  sourceView.value?.showLine(problem.line);
}
</script>

<template>
  <PageBar :crumbs="crumbs">
    <span aria-hidden="true">{{
      name === null ? "Upload" : "New version"
    }}</span>
    <span class="sr-only">{{
      name === null ? "Add a skill" : `A new version of ${name}`
    }}</span>
  </PageBar>

  <!-- From `lg` the file and the check each scroll in their own column; below, one page. -->
  <div class="lg:flex lg:min-h-0 lg:flex-1">
    <div class="min-w-0 lg:flex-1 lg:overflow-y-auto">
      <div class="mx-auto w-full max-w-3xl space-y-6 px-6 pt-6">
        <PermissionNote :permission="editing" />
        <NoteBanner
          v-if="name !== null && current !== null && current.hash === null"
          tone="idle"
          class="text-muted-foreground"
        >
          {{ name }} lives in the repo: change hermes/skills/{{
            name
          }}/skill.yaml there (its page has the file to start from).
        </NoteBanner>
        <NoteBanner v-if="name !== null && currentError !== null" tone="fail">
          {{ currentError }}
        </NoteBanner>

        <section aria-labelledby="skill-source" class="min-w-0 space-y-4">
          <h2 id="skill-source" class="sr-only">The skill.yaml</h2>

          <div v-if="name === null" class="grid gap-1.5">
            <Label :for="ids.name">Name</Label>
            <Input
              :id="ids.name"
              v-model="skillName"
              class="font-mono"
              placeholder="qa-…"
              autocomplete="off"
              spellcheck="false"
              :aria-invalid="nameHint !== null && skillName.trim() !== ''"
              :aria-describedby="`${ids.name}-hint`"
            />
            <p
              :id="`${ids.name}-hint`"
              class="text-xs"
              :class="
                nameHint !== null && skillName.trim() !== ''
                  ? 'text-fail'
                  : 'text-muted-foreground'
              "
            >
              {{ nameHint ?? `Its folder: hermes/skills/${skillName.trim()}/` }}
            </p>
          </div>

          <template v-if="text === '' && !typing">
            <SkillDropZone @file="takeFile" />
            <p class="text-xs text-muted-foreground">
              Or
              <button
                type="button"
                class="rounded-sm text-run underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
                @click="typing = true"
              >
                paste its text</button
              >.
            </p>
            <SkillFieldsHelp />
          </template>

          <template v-else>
            <div class="flex flex-wrap items-center gap-1.5">
              <p
                class="mr-auto min-w-0 truncate font-mono text-xs text-muted-foreground"
              >
                {{ fileName ?? "Pasted text" }}
              </p>
              <Button
                v-if="text !== ''"
                size="sm"
                variant="outline"
                @click="typing = !typing"
              >
                {{ typing ? "Done" : "Edit" }}
              </Button>
              <Button size="sm" variant="ghost" @click="startOver()">
                Start over
              </Button>
            </div>
            <Textarea
              v-if="typing"
              :id="ids.text"
              v-model="text"
              aria-label="skill.yaml text"
              class="max-h-[36rem] min-h-[28rem] bg-muted font-mono text-xs leading-5"
              spellcheck="false"
              wrap="off"
              placeholder="description: …"
            />
            <CodeView
              v-else
              ref="sourceView"
              :text="text"
              :label="fileName ?? 'skill.yaml'"
              :marks="marks"
            />
          </template>

          <NoteBanner v-if="fileProblem !== null" tone="fail" alert>
            {{ fileProblem }}
          </NoteBanner>
        </section>
      </div>

      <footer class="sticky bottom-0 z-[5] mt-6 border-t bg-background">
        <div
          class="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-x-4 gap-y-2 px-6 py-3"
        >
          <p class="min-w-0 flex-1 basis-60 text-xs text-muted-foreground">
            {{ happens }}
          </p>
          <div class="ml-auto flex shrink-0 items-center gap-1.5">
            <Button variant="ghost" size="sm" as-child>
              <RouterLink :to="cancelTo">Cancel</RouterLink>
            </Button>
            <Button size="sm" :disabled="!canSave" @click="save()">{{
              saveLabel
            }}</Button>
          </div>
        </div>
      </footer>
    </div>

    <aside
      class="min-w-0 px-6 py-6 max-lg:border-t lg:w-[26rem] lg:shrink-0 lg:overflow-y-auto lg:border-l lg:px-5 xl:w-[30rem]"
    >
      <SkillCheckPanel
        :status="status"
        :problems="problems"
        :result="result"
        locate="line"
        :yaml="null"
        @show="showProblem"
      />
    </aside>
  </div>
</template>
