<script setup lang="ts">
import { PlusIcon, XIcon } from "@lucide/vue";
import type { ISkillProblem, ISkillSafety } from "@shared/types";
import { useId } from "vue";
import { fieldId } from "@/lib/skill-draft";
import { SAFETY_WORDS } from "@/lib/skills";
import type { ISkillDraft } from "@/types";
import ListField from "./ListField.vue";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group";
import { Switch } from "./ui/switch";
import { Textarea } from "./ui/textarea";

// A skill as a form: every field of its skill.yaml, in the order the skill reads. The console's
// problems stand under the field they are about (by their path in the file).

const props = defineProps<{ problems: ISkillProblem[] }>();
const draft = defineModel<ISkillDraft>({ required: true });

const SAFETIES: ISkillSafety[] = [
  "read_only",
  "records_activity",
  "creates_data",
];
const ids = { safety: useId(), ai: useId(), shots: useId() };

function set<TKey extends keyof ISkillDraft>(
  key: TKey,
  value: ISkillDraft[TKey]
): void {
  draft.value = { ...draft.value, [key]: value };
}

function errorsAt(path: (string | number)[]): string[] {
  const wanted = JSON.stringify(path);
  return props.problems
    .filter((problem) => JSON.stringify(problem.path) === wanted)
    .map((problem) => problem.message);
}

function chooseSafety(value: unknown): void {
  const chosen = SAFETIES.find((safety) => safety === value);
  if (chosen !== undefined) {
    set("safety", chosen);
  }
}

function toggleShots(on: boolean): void {
  set("screenshots", on ? { folder: "", files: [""] } : null);
}

function setSection(
  index: number,
  key: "title" | "text",
  value: string | number
): void {
  set(
    "sections",
    draft.value.sections.map((section, at) =>
      at === index ? { ...section, [key]: String(value) } : section
    )
  );
}
</script>

<template>
  <div class="grid grid-cols-1 gap-8">
    <section aria-labelledby="form-basics" class="grid gap-4">
      <h3 id="form-basics" class="text-sm font-semibold">What it is</h3>
      <div class="grid gap-1.5">
        <Label :for="fieldId(['title'])">Title</Label>
        <Input
          :id="fieldId(['title'])"
          :model-value="draft.title"
          :aria-invalid="errorsAt(['title']).length > 0"
          placeholder="Example app — the quizzes page (read-only check)"
          @update:model-value="(value) => set('title', String(value))"
        />
        <p
          v-for="(message, at) in errorsAt(['title'])"
          :key="at"
          class="text-xs text-fail"
        >
          {{ message }}
        </p>
      </div>
      <div class="grid gap-1.5">
        <Label :for="fieldId(['description'])">Description</Label>
        <p class="-mt-1 text-xs text-muted-foreground">
          What it checks and when to use it: Hermes's list of skills and New run
          show it.
        </p>
        <Textarea
          :id="fieldId(['description'])"
          :model-value="draft.description"
          :aria-invalid="errorsAt(['description']).length > 0"
          class="text-sm"
          @update:model-value="(value) => set('description', String(value))"
        />
        <p
          v-for="(message, at) in errorsAt(['description'])"
          :key="at"
          class="text-xs text-fail"
        >
          {{ message }}
        </p>
      </div>
      <div class="grid gap-1.5">
        <Label :for="fieldId(['summary'])">Summary</Label>
        <p class="-mt-1 text-xs text-muted-foreground">
          What it does, in a few sentences: the first thing the agent reads.
        </p>
        <Textarea
          :id="fieldId(['summary'])"
          :model-value="draft.summary"
          :aria-invalid="errorsAt(['summary']).length > 0"
          class="text-sm"
          @update:model-value="(value) => set('summary', String(value))"
        />
        <p
          v-for="(message, at) in errorsAt(['summary'])"
          :key="at"
          class="text-xs text-fail"
        >
          {{ message }}
        </p>
      </div>
    </section>

    <section aria-labelledby="form-changes" class="grid gap-4">
      <h3 id="form-changes" class="text-sm font-semibold">What it changes</h3>
      <RadioGroup
        :id="fieldId(['safety'])"
        :model-value="draft.safety"
        :aria-labelledby="'form-changes'"
        class="grid gap-3"
        @update:model-value="chooseSafety"
      >
        <div
          v-for="safety in SAFETIES"
          :key="safety"
          class="flex items-start gap-2.5"
        >
          <RadioGroupItem
            :id="`${ids.safety}-${safety}`"
            :value="safety"
            class="mt-0.5"
          />
          <Label
            :for="`${ids.safety}-${safety}`"
            class="grid gap-0.5 font-normal"
          >
            <span class="font-medium">{{ SAFETY_WORDS[safety].label }}</span>
            <span class="text-xs leading-snug text-muted-foreground">{{
              SAFETY_WORDS[safety].hint
            }}</span>
          </Label>
        </div>
      </RadioGroup>
      <div v-if="draft.safety !== 'read_only'" class="grid gap-1.5">
        <Label :for="fieldId(['side_effects'])"
          >What exactly it records or creates</Label
        >
        <Textarea
          :id="fieldId(['side_effects'])"
          :model-value="draft.side_effects"
          :aria-invalid="errorsAt(['side_effects']).length > 0"
          :placeholder="
            draft.safety === 'creates_data'
              ? 'one Learning Path, with up to 2 existing courses attached'
              : 'one learner attempt for the test account'
          "
          class="text-sm"
          @update:model-value="(value) => set('side_effects', String(value))"
        />
        <p
          v-for="(message, at) in errorsAt(['side_effects'])"
          :key="at"
          class="text-xs text-fail"
        >
          {{ message }}
        </p>
      </div>
      <div class="flex items-center gap-2.5">
        <Switch
          :id="ids.ai"
          :model-value="draft.ai_credits"
          @update:model-value="(value) => set('ai_credits', value === true)"
        />
        <Label :for="ids.ai" class="font-normal">It spends AI credits</Label>
      </div>
    </section>

    <section aria-labelledby="form-setup" class="grid gap-4">
      <h3 id="form-setup" class="text-sm font-semibold">Before it starts</h3>
      <div class="grid gap-4 sm:grid-cols-2">
        <div class="grid gap-1.5">
          <Label :for="fieldId(['start_at'])">Start page</Label>
          <Input
            :id="fieldId(['start_at'])"
            :model-value="draft.start_at"
            :aria-invalid="errorsAt(['start_at']).length > 0"
            class="font-mono text-sm"
            placeholder="/dashboard/quizzes"
            @update:model-value="(value) => set('start_at', String(value))"
          />
          <p
            v-for="(message, at) in errorsAt(['start_at'])"
            :key="at"
            class="text-xs text-fail"
          >
            {{ message }}
          </p>
        </div>
        <div class="grid gap-1.5">
          <Label :for="fieldId(['arguments'])">Arguments (optional)</Label>
          <Input
            :id="fieldId(['arguments'])"
            :model-value="draft.arguments"
            placeholder="the asset type, a registry slug"
            @update:model-value="(value) => set('arguments', String(value))"
          />
        </div>
      </div>
      <ListField
        :model-value="draft.rules"
        label="Rules"
        hint="What to keep to all along (optional)."
        item-label="Rule"
        add-label="Add a rule"
        :path="['rules']"
        :errors-at="errorsAt"
        @update:model-value="(value) => set('rules', value)"
      />
    </section>

    <ListField
      :model-value="draft.steps"
      label="Steps"
      hint="What to do, in order. A step may hold a list, a table or a code block."
      item-label="Step"
      add-label="Add a step"
      :path="['steps']"
      :errors-at="errorsAt"
      ordered
      @update:model-value="(value) => set('steps', value)"
    />

    <section aria-labelledby="form-shots" class="grid gap-4">
      <div class="flex items-center gap-2.5">
        <Switch
          :id="ids.shots"
          :model-value="draft.screenshots !== null"
          @update:model-value="(value) => toggleShots(value === true)"
        />
        <Label id="form-shots" :for="ids.shots" class="text-sm font-semibold"
          >The agent saves screenshots</Label
        >
      </div>
      <template v-if="draft.screenshots !== null">
        <div class="grid gap-1.5">
          <Label :for="fieldId(['screenshots', 'folder'])">Folder</Label>
          <Input
            :id="fieldId(['screenshots', 'folder'])"
            :model-value="draft.screenshots.folder"
            :aria-invalid="errorsAt(['screenshots', 'folder']).length > 0"
            class="font-mono text-sm sm:max-w-xs"
            placeholder="quiz"
            @update:model-value="
              (value) =>
                set('screenshots', {
                  folder: String(value),
                  files: draft.screenshots?.files ?? [],
                })
            "
          />
          <p class="text-xs text-muted-foreground">
            Under ~/nemo-output/smoke-screens/&lt;env&gt;/
          </p>
          <p
            v-for="(message, at) in errorsAt(['screenshots', 'folder'])"
            :key="at"
            class="text-xs text-fail"
          >
            {{ message }}
          </p>
        </div>
        <ListField
          :model-value="draft.screenshots.files"
          label="Files"
          hint="Each with when to take it: `01-list.png`: the list once it loaded."
          item-label="Screenshot"
          add-label="Add a screenshot"
          :path="['screenshots', 'files']"
          :errors-at="errorsAt"
          @update:model-value="
            (value) =>
              set('screenshots', {
                folder: draft.screenshots?.folder ?? '',
                files: value,
              })
          "
        />
      </template>
    </section>

    <section aria-labelledby="form-report" class="grid gap-5">
      <h3 id="form-report" class="text-sm font-semibold">Report</h3>
      <ListField
        :model-value="draft.report"
        label="What the report gives"
        hint="After its RESULT: PASS or RESULT: FAIL line."
        item-label="Report item"
        add-label="Add an item"
        :path="['report']"
        :errors-at="errorsAt"
        @update:model-value="(value) => set('report', value)"
      />
      <ListField
        :model-value="draft.pass_if"
        label="Passes when"
        hint="Any of these (optional; none: whenever no fail case holds)."
        item-label="Pass case"
        add-label="Add a pass case"
        :path="['pass_if']"
        :errors-at="errorsAt"
        @update:model-value="(value) => set('pass_if', value)"
      />
      <ListField
        :model-value="draft.fail_if"
        label="Fails when"
        hint="Any of these."
        item-label="Fail case"
        add-label="Add a fail case"
        :path="['fail_if']"
        :errors-at="errorsAt"
        @update:model-value="(value) => set('fail_if', value)"
      />
      <ListField
        :model-value="draft.not_a_failure"
        label="Not a failure"
        hint="What may look wrong but does not fail it (optional)."
        item-label="Case"
        add-label="Add a case"
        :path="['not_a_failure']"
        :errors-at="errorsAt"
        @update:model-value="(value) => set('not_a_failure', value)"
      />
    </section>

    <details
      class="group rounded-md ring-1 ring-border"
      :open="draft.sections.length > 0"
    >
      <summary
        class="cursor-pointer rounded-md px-3 py-2 text-sm font-medium outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        More sections (optional): a one-time setup, credentials a script needs…
      </summary>
      <div class="grid gap-4 border-t px-3 py-3">
        <div
          v-for="(section, index) in draft.sections"
          :key="index"
          class="grid gap-2 rounded-md border px-3 py-3"
        >
          <div class="flex items-center gap-2">
            <Input
              :id="fieldId(['sections', index, 'title'])"
              :model-value="section.title"
              :aria-label="`Section ${index + 1} title`"
              placeholder="One-time setup"
              @update:model-value="(value) => setSection(index, 'title', value)"
            />
            <Button
              variant="ghost"
              size="icon-sm"
              :aria-label="`Remove section ${index + 1}`"
              @click="
                set(
                  'sections',
                  draft.sections.filter((_section, at) => at !== index)
                )
              "
            >
              <XIcon aria-hidden="true" />
            </Button>
          </div>
          <Textarea
            :id="fieldId(['sections', index, 'text'])"
            :model-value="section.text"
            :aria-label="`Section ${index + 1} text`"
            class="text-sm"
            @update:model-value="(value) => setSection(index, 'text', value)"
          />
          <p
            v-for="(message, at) in [
              ...errorsAt(['sections', index, 'title']),
              ...errorsAt(['sections', index, 'text']),
            ]"
            :key="at"
            class="text-xs text-fail"
          >
            {{ message }}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          class="justify-self-start"
          @click="set('sections', [...draft.sections, { title: '', text: '' }])"
        >
          <PlusIcon aria-hidden="true" />
          Add a section
        </Button>
      </div>
    </details>
  </div>
</template>
