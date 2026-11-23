<script setup lang="ts">
import { SKILL_MAX_BYTES } from "@shared/api";
import type { ISkillProblem } from "@shared/types";
import { useTitle } from "@vueuse/core";
import { computed, nextTick, ref, useId } from "vue";
import CodeView from "@/components/CodeView.vue";
import PermissionNote from "@/components/PermissionNote.vue";
import SkillCheckPanel from "@/components/SkillCheckPanel.vue";
import SkillDropZone from "@/components/SkillDropZone.vue";
import SkillFieldsHelp from "@/components/SkillFieldsHelp.vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useSkillEditor } from "@/composables/useSkillEditor";
import { skillPath, skillsPath } from "@/lib/paths";
import { skillNameHint } from "@/lib/skills";
import type { ITone } from "@/types";

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
  <div class="mx-auto w-full max-w-6xl space-y-6 px-6 py-8">
    <nav
      aria-label="Breadcrumb"
      class="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground"
    >
      <RouterLink
        :to="skillsPath()"
        class="rounded-sm underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
        >Skills</RouterLink
      >
      <template v-if="name !== null">
        <span aria-hidden="true">/</span>
        <RouterLink
          :to="skillPath(name, replacedOrigin)"
          class="rounded-sm font-mono text-xs underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
          >{{ name }}</RouterLink
        >
      </template>
    </nav>

    <div>
      <h1 class="text-2xl font-semibold tracking-tight">
        {{ name === null ? "Add a skill" : `A new version of ${name}` }}
      </h1>
      <p class="mt-1 max-w-prose text-sm text-muted-foreground">
        Bring its skill.yaml: drop the file or paste the text. The console
        checks it as you go and shows what Hermes will read; once it has no
        errors, {{ name === null ? "add it" : "save it" }} and it is ready to
        run.
      </p>
    </div>

    <PermissionNote :permission="editing" />
    <p
      v-if="name !== null && current !== null && current.hash === null"
      class="rounded-md border bg-muted/40 px-4 py-3 text-sm"
    >
      {{ name }} lives in the repo: change hermes/skills/{{ name }}/skill.yaml
      there (its page has the file to start from).
    </p>
    <p
      v-if="name !== null && currentError !== null"
      class="rounded-md border border-fail/30 bg-fail/5 px-4 py-3 text-sm text-fail"
    >
      {{ currentError }}
    </p>

    <div class="grid items-start gap-6 lg:grid-cols-2">
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
          <p class="text-sm text-muted-foreground">
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
          <div class="flex flex-wrap items-center gap-2">
            <p class="mr-auto truncate font-mono text-xs text-muted-foreground">
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
            class="min-h-[28rem] font-mono text-xs leading-5"
            spellcheck="false"
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

        <p
          v-if="fileProblem !== null"
          role="alert"
          class="rounded-md border border-fail/30 bg-fail/5 px-4 py-3 text-sm text-fail"
        >
          {{ fileProblem }}
        </p>
      </section>

      <SkillCheckPanel
        :status="status"
        :problems="problems"
        :result="result"
        locate="line"
        :yaml="null"
        @show="showProblem"
      />
    </div>

    <footer class="flex flex-wrap items-center gap-x-6 gap-y-3 border-t pt-4">
      <p class="mr-auto max-w-prose text-sm text-muted-foreground">
        {{ happens }}
      </p>
      <Button variant="ghost" as-child>
        <RouterLink :to="cancelTo">Cancel</RouterLink>
      </Button>
      <Button :disabled="!canSave" @click="save()">{{ saveLabel }}</Button>
    </footer>
  </div>
</template>
