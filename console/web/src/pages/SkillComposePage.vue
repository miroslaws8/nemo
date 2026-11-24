<script setup lang="ts">
import type { ISkillOrigin, ISkillProblem } from "@shared/types";
import { useTitle } from "@vueuse/core";
import { computed, nextTick, ref, useId, watch } from "vue";
import NoteBanner from "@/components/NoteBanner.vue";
import PageBar from "@/components/PageBar.vue";
import PermissionNote from "@/components/PermissionNote.vue";
import SkillCheckPanel from "@/components/SkillCheckPanel.vue";
import SkillForm from "@/components/SkillForm.vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useSkillEditor } from "@/composables/useSkillEditor";
import { skillStart } from "@/state/dialogs";
import { useSkillDetail, useSkillTemplates } from "@/composables/useSkills";
import { newSkillPath, skillsPath } from "@/lib/paths";
import {
  draftFromFields,
  draftFromYaml,
  draftToYaml,
  emptyDraft,
  fieldId,
} from "@/lib/skill-draft";
import { skillNameHint } from "@/lib/skills";
import type { ISkillDraft } from "@/types";

// A new skill made in a form: from a template (`template`), from a copy of a skill (`from`), or
// blank. The form makes the skill.yaml the console checks at every pause; "YAML" shows that file
// to edit by hand, and back. The template's [[…]] places must be filled in before it can be added.

const props = defineProps<{
  template: string | null;
  from: string | null;
  origin: ISkillOrigin | null;
}>();

const ids = { name: useId(), mode: useId(), yaml: useId() };
const skillName = ref("");
const draft = ref<ISkillDraft>(emptyDraft());
const mode = ref<"form" | "yaml">("form");
const yamlText = ref("");
const yamlProblem = ref<string | null>(null);
// The skill.yaml it started as: leaving without a change asks nothing.
const startYaml = ref("");
const ready = ref(props.template === null && props.from === null);
const panel = ref<InstanceType<typeof SkillCheckPanel> | null>(null);

const { templates, error: templatesError } = useSkillTemplates();
const { detail: copied, error: copyError } = useSkillDetail(
  () => props.from,
  () => props.origin,
  () => null
);
const chosenTemplate = computed(
  () =>
    templates.value?.templates.find(
      (candidate) => candidate.id === props.template
    ) ?? null
);

function start(next: ISkillDraft): void {
  draft.value = next;
  startYaml.value = draftToYaml(next);
  ready.value = true;
}

watch(
  [chosenTemplate, copied],
  ([template, skill]) => {
    if (ready.value) {
      return;
    }
    if (props.template !== null && template !== null) {
      start(draftFromFields(template.fields));
    } else if (props.from !== null && skill?.fields) {
      start(draftFromFields(skill.fields));
    }
  },
  { immediate: true }
);
if (ready.value) {
  startYaml.value = draftToYaml(draft.value);
}

// A skill AI wrote from a description: the form opens on it, as unsaved work.
const written = skillStart.value;
skillStart.value = null;
if (written !== null && ready.value) {
  skillName.value = written.name;
  const read = draftFromYaml(written.yaml);
  if (read === null) {
    mode.value = "yaml";
    yamlText.value = written.yaml;
  } else {
    draft.value = read;
  }
  startYaml.value = "";
}

const loadProblem = computed(() => {
  if (props.template !== null) {
    if (templatesError.value !== null) {
      return templatesError.value;
    }
    return templates.value !== null && chosenTemplate.value === null
      ? `There is no template ${props.template}.`
      : null;
  }
  if (props.from !== null) {
    if (copyError.value !== null) {
      return copyError.value;
    }
    return copied.value !== null && copied.value.fields === null
      ? `${props.from} has no skill.yaml here to copy.`
      : null;
  }
  return null;
});

const yaml = computed(() =>
  mode.value === "form" ? draftToYaml(draft.value) : yamlText.value
);

// The last crumb: what it starts from, short.
const crumb = computed(() =>
  props.from !== null
    ? `Copy of ${props.from}`
    : chosenTemplate.value?.label ?? "Form"
);

const pageTitle = computed(() =>
  props.from !== null
    ? `A new skill from ${props.from}`
    : chosenTemplate.value !== null
    ? chosenTemplate.value.label
    : "A new skill"
);

useTitle(
  computed(() =>
    props.from !== null
      ? `A copy of ${props.from} · Skills · QA Console`
      : "A new skill · Skills · QA Console"
  )
);

const { editing, result, problems, status, canSave, saveLabel, happens, save } =
  useSkillEditor({
    replacing: () => null,
    name: () => skillName.value,
    yaml: () => (ready.value ? yaml.value : ""),
    unsaved: () =>
      ready.value &&
      (yaml.value !== startYaml.value || skillName.value.trim() !== ""),
  });

const nameHint = computed(() => skillNameHint(skillName.value));

function chooseMode(value: unknown): void {
  if (value === "yaml" && mode.value === "form") {
    yamlText.value = draftToYaml(draft.value);
    yamlProblem.value = null;
    mode.value = "yaml";
  } else if (value === "form" && mode.value === "yaml") {
    const read = draftFromYaml(yamlText.value);
    if (read === null) {
      yamlProblem.value =
        "This YAML does not read as a skill's fields: fix it to go back to the form.";
      return;
    }
    draft.value = read;
    yamlProblem.value = null;
    mode.value = "form";
  }
}

// A problem's place: its field in the form (or the nearest one that is there), else its line.
async function showProblem(problem: ISkillProblem): Promise<void> {
  if (mode.value === "form") {
    for (let length = problem.path.length; length > 0; length -= 1) {
      const element = document.getElementById(
        fieldId(problem.path.slice(0, length))
      );
      if (element !== null) {
        element.scrollIntoView({ block: "center", behavior: "smooth" });
        await nextTick();
        element.focus({ preventScroll: true });
        return;
      }
    }
  }
  if (problem.line !== null) {
    await panel.value?.showLine(problem.line);
  }
}
</script>

<template>
  <PageBar
    :crumbs="[
      { label: 'Skills', to: skillsPath() },
      { label: 'New skill', to: newSkillPath() },
    ]"
    :title="pageTitle"
  >
    <span aria-hidden="true">{{ crumb }}</span>
    <span class="sr-only">{{ pageTitle }}</span>
  </PageBar>

  <!-- From `lg` the form and the check each scroll in their own column; below, one page. -->
  <div class="lg:flex lg:min-h-0 lg:flex-1">
    <div class="min-w-0 lg:flex-1 lg:overflow-y-auto">
      <div class="mx-auto w-full max-w-3xl space-y-6 px-6 pt-6">
        <PermissionNote :permission="editing" />
        <NoteBanner v-if="loadProblem !== null" tone="fail" alert>
          {{ loadProblem }}
        </NoteBanner>

        <section
          v-if="ready"
          aria-labelledby="compose-skill"
          class="min-w-0 space-y-6"
        >
          <h2 id="compose-skill" class="sr-only">The skill</h2>
          <div class="grid gap-1.5">
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

          <div class="flex flex-wrap items-center gap-3">
            <span :id="ids.mode" class="text-sm font-medium">Edit it as</span>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              :model-value="mode"
              :aria-labelledby="ids.mode"
              @update:model-value="chooseMode"
            >
              <ToggleGroupItem value="form">Form</ToggleGroupItem>
              <ToggleGroupItem value="yaml">YAML</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <NoteBanner v-if="yamlProblem !== null" tone="fail" alert>
            {{ yamlProblem }}
          </NoteBanner>
          <p
            v-if="template !== null"
            class="-mt-3 text-xs text-muted-foreground"
          >
            First fill in the places marked [[…]]: the template left them for
            your words.
          </p>

          <SkillForm
            v-if="mode === 'form'"
            v-model="draft"
            :problems="problems"
          />
          <Textarea
            v-else
            :id="ids.yaml"
            v-model="yamlText"
            aria-label="skill.yaml text"
            class="max-h-[36rem] min-h-[28rem] bg-muted font-mono text-xs leading-5"
            spellcheck="false"
            wrap="off"
          />
        </section>
        <div
          v-else-if="loadProblem === null"
          class="grid gap-3"
          aria-label="Reading what it starts from"
        >
          <Skeleton class="h-8 w-full max-w-80" />
          <Skeleton class="h-64 w-full" />
        </div>
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
              <RouterLink :to="newSkillPath()">Cancel</RouterLink>
            </Button>
            <Button size="sm" :disabled="!canSave" @click="save()">{{
              saveLabel
            }}</Button>
          </div>
        </div>
      </footer>
    </div>

    <aside
      v-if="ready"
      class="min-w-0 px-6 py-6 max-lg:border-t lg:w-[26rem] lg:shrink-0 lg:overflow-y-auto lg:border-l lg:px-5 xl:w-[30rem]"
    >
      <SkillCheckPanel
        ref="panel"
        :status="status"
        :problems="problems"
        :result="result"
        :locate="mode === 'form' ? 'field' : 'line'"
        :yaml="yaml"
        @show="showProblem"
      />
    </aside>
  </div>
</template>
