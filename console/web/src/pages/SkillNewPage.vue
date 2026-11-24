<script setup lang="ts">
import type { ISkillSummary } from "@shared/types";
import { CopyIcon, FileUpIcon, SparklesIcon } from "@lucide/vue";
import { skillWrittenSchema } from "@shared/api";
import { useTitle } from "@vueuse/core";
import { computed, onBeforeUnmount, ref, useId } from "vue";
import { useRouter } from "vue-router";
import PageBar from "@/components/PageBar.vue";
import PermissionNote from "@/components/PermissionNote.vue";
import SkillChip from "@/components/SkillChip.vue";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "vue-sonner";
import { messageOf, postJson } from "@/lib/api";
import { skillStart } from "@/state/dialogs";
import { useSkillList, useSkillTemplates } from "@/composables/useSkills";
import {
  composeSkillPath,
  skillsPath,
  uploadSkillPath,
  writtenSkillPath,
} from "@/lib/paths";
import { SAFETY_WORDS } from "@/lib/skills";
import { mayEditSkills } from "@/state/access";
import { consoleConfig, storeWords } from "@/state/config";

// Where a new skill starts: a description AI turns into a skill.yaml, a template
// (hermes/skill-templates), a copy of a skill, or a skill.yaml brought in. All but the last open
// the skill's form.

useTitle("Add a skill · Skills · QA Console");
const router = useRouter();
const copyId = useId();
const describeId = useId();
// What the skill should check, in plain words (POST /api/skills/write).
const description = ref("");
const writing = ref(false);
const writer = computed(() => consoleConfig.value?.skillWriting ?? null);
const canWrite = computed(
  () =>
    editing.value.allowed &&
    writer.value?.available === true &&
    description.value.trim().length >= 10 &&
    !writing.value
);

// Left before the model answered: the answer goes nowhere (no jump back to the form).
let left = false;
onBeforeUnmount(() => {
  left = true;
});

async function write(): Promise<void> {
  writing.value = true;
  try {
    const written = await postJson(
      "/api/skills/write",
      { description: description.value.trim() },
      skillWrittenSchema
    );
    if (left) {
      return;
    }
    skillStart.value = { name: written.name, yaml: written.yaml };
    if ((await router.push(writtenSkillPath())) !== undefined) {
      // The form did not open: no later blank form may open on this skill.
      skillStart.value = null;
    }
  } catch (failure) {
    toast.error(messageOf(failure));
  } finally {
    writing.value = false;
  }
}
const editing = computed(() => mayEditSkills());
const whereItGoes = computed(() =>
  storeWords.value.addSkill.replace("{name}", "<name>")
);

const { templates, error: templatesError } = useSkillTemplates();
const { list } = useSkillList(() => null);
// A copy needs the skill's fields: a skill whose skill.yaml reads.
const copyable = computed(() =>
  (list.value?.skills ?? []).filter(
    (skill) => skill.problem === null && skill.title !== null
  )
);
const copied = ref("");
const skillKey = (skill: ISkillSummary): string =>
  `${skill.name}:${skill.origin}`;
const chosen = computed(
  () => copyable.value.find((skill) => skillKey(skill) === copied.value) ?? null
);

function copy(): void {
  const [name, origin] = copied.value.split(":");
  if (name === undefined || name === "") {
    return;
  }
  void router.push(
    composeSkillPath({
      from: name,
      origin: origin === "console" ? "console" : null,
    })
  );
}
</script>

<template>
  <PageBar>
    <span>Add a skill</span>
  </PageBar>

  <div class="space-y-8 px-6 py-5">
    <nav aria-label="Breadcrumb" class="text-sm">
      <RouterLink
        :to="skillsPath()"
        class="rounded-sm text-muted-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
        >Skills</RouterLink
      >
    </nav>

    <div>
      <h1 class="text-2xl font-semibold tracking-tight">Add a skill</h1>
      <p class="mt-1 max-w-prose text-sm text-muted-foreground">
        Start from a template or from a skill you have, and fill in its form; or
        bring a skill.yaml. Either way the console checks it as you go.
        {{ whereItGoes }}
      </p>
    </div>
    <PermissionNote :permission="editing" />

    <section aria-labelledby="new-from-description" class="space-y-3">
      <h2 id="new-from-description" class="text-base font-semibold">
        Describe it
      </h2>
      <p class="max-w-prose text-sm text-muted-foreground">
        Say in plain words what the agent should check. AI writes the skill and
        opens it in the form, already checked, for you to read, adjust and add.
      </p>
      <div class="grid max-w-2xl gap-2">
        <Label :for="describeId" class="sr-only">What the skill checks</Label>
        <Textarea
          :id="describeId"
          v-model="description"
          rows="3"
          maxlength="1000"
          :disabled="!editing.allowed || writer?.available !== true"
          placeholder="On a phone, open the pricing page, check every plan shows a price and a button, and look for text that is cut off"
        />
        <div class="flex flex-wrap items-center gap-3">
          <Button :disabled="!canWrite" @click="write">
            <SparklesIcon class="size-4" aria-hidden="true" />
            {{ writing ? "Writing…" : "Write the skill" }}
          </Button>
          <p
            v-if="writer !== null && !writer.available"
            class="text-xs text-muted-foreground"
          >
            Not here: {{ writer.reason }}.
          </p>
        </div>
      </div>
    </section>

    <section aria-labelledby="new-from-template" class="space-y-3">
      <h2 id="new-from-template" class="text-base font-semibold">
        Start from a template
      </h2>
      <p
        v-if="templatesError !== null"
        class="rounded-md border border-fail/30 bg-fail/5 px-4 py-3 text-sm text-fail"
      >
        {{ templatesError }}
      </p>
      <ul v-else-if="templates !== null" class="grid gap-3 sm:grid-cols-3">
        <li
          v-for="template in templates.templates"
          :key="template.id"
          class="relative flex flex-col gap-2 rounded-lg border bg-card p-4 transition-colors focus-within:bg-accent/40 hover:bg-accent/40"
        >
          <SkillChip
            class="self-start"
            :tone="SAFETY_WORDS[template.fields.safety].tone"
            :label="SAFETY_WORDS[template.fields.safety].label"
          />
          <RouterLink
            v-if="editing.allowed"
            :to="composeSkillPath({ template: template.id })"
            class="rounded-sm font-medium outline-none after:absolute after:inset-0 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring/50"
            >{{ template.label }}</RouterLink
          >
          <p v-else class="font-medium">{{ template.label }}</p>
          <p class="text-sm text-muted-foreground">{{ template.about }}</p>
        </li>
      </ul>
      <div
        v-else
        class="grid gap-3 sm:grid-cols-3"
        aria-label="Reading the templates"
      >
        <Skeleton class="h-36" />
        <Skeleton class="h-36" />
        <Skeleton class="h-36" />
      </div>
    </section>

    <section aria-labelledby="new-from-copy" class="space-y-3">
      <h2 id="new-from-copy" class="text-base font-semibold">Copy a skill</h2>
      <div class="flex flex-wrap items-end gap-3">
        <div class="grid min-w-64 flex-1 grid-cols-1 gap-1.5 sm:max-w-md">
          <Label :for="copyId">The skill to start from</Label>
          <Select v-model="copied" :disabled="!editing.allowed">
            <SelectTrigger :id="copyId" class="w-full">
              <!-- Its own markup: the select would show the option's text run together, uncut. -->
              <SelectValue placeholder="Pick a skill">
                <template v-if="chosen !== null">
                  <span class="truncate">{{
                    chosen.title ?? chosen.name
                  }}</span>
                  <span
                    class="shrink-0 font-mono text-xs text-muted-foreground"
                    >{{ chosen.name }}</span
                  >
                </template>
                <template v-else>Pick a skill</template>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="skill in copyable"
                :key="skillKey(skill)"
                :value="skillKey(skill)"
              >
                <span>{{ skill.title ?? skill.name }}</span>
                <span
                  class="shrink-0 font-mono text-xs text-muted-foreground"
                  >{{ skill.name }}</span
                >
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="outline"
          :disabled="!editing.allowed || copied === ''"
          @click="copy()"
        >
          <CopyIcon aria-hidden="true" />
          Copy it
        </Button>
      </div>
    </section>

    <section aria-labelledby="new-from-file" class="space-y-3">
      <h2 id="new-from-file" class="text-base font-semibold">
        Bring a skill.yaml
      </h2>
      <p class="text-sm text-muted-foreground">A file you have, or its text.</p>
      <Button v-if="editing.allowed" variant="outline" as-child>
        <RouterLink :to="uploadSkillPath()">
          <FileUpIcon aria-hidden="true" />
          Upload or paste
        </RouterLink>
      </Button>
      <Button v-else variant="outline" disabled>
        <FileUpIcon aria-hidden="true" />
        Upload or paste
      </Button>
    </section>
  </div>
</template>
