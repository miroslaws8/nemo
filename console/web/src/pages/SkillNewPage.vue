<script setup lang="ts">
import type { ISkillSummary } from "@shared/types";
import {
  ChevronRightIcon,
  CopyIcon,
  FileUpIcon,
  SparklesIcon,
} from "@lucide/vue";
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
// The words beside the Write button: what AI does, or why it cannot here (a reason only when
// the console gave one).
const writerWords = computed(() => {
  if (writer.value === null || writer.value.available) {
    return "AI writes the skill and opens it in the form, checked.";
  }
  const reason = writer.value.reason;
  return typeof reason === "string" && reason !== ""
    ? `AI writing is off on this console: ${reason}`
    : "AI writing is off on this console";
});
const composerOff = computed(
  () => !editing.value.allowed || writer.value?.available !== true
);
// ⌘/Ctrl+Enter in the box writes, the same as the button (not while an input method composes).
function writeFromKeys(event: KeyboardEvent): void {
  if (
    !(event.metaKey || event.ctrlKey) ||
    event.key !== "Enter" ||
    event.isComposing
  ) {
    return;
  }
  event.preventDefault();
  if (canWrite.value) {
    void write();
  }
}
// The copy row opens in place to its picker.
const copyOpen = ref(false);
const ROW =
  "flex h-11 w-full items-center gap-3 px-4 text-left text-sm outline-none transition-colors";
const ROW_LIVE =
  "hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset";
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
  <PageBar :crumbs="[{ label: 'Skills', to: skillsPath() }]">
    New skill
  </PageBar>

  <div class="mx-auto w-full max-w-2xl px-6 py-10">
    <PermissionNote :permission="editing" class="mb-4" />

    <div
      class="overflow-hidden rounded-lg bg-background ring-1 ring-border transition-shadow focus-within:ring-ring/50"
      :class="{ 'opacity-60': composerOff }"
    >
      <Label :for="describeId" class="sr-only">What the skill checks</Label>
      <Textarea
        :id="describeId"
        v-model="description"
        maxlength="1000"
        :disabled="composerOff"
        class="min-h-28 resize-none rounded-none border-0 bg-transparent px-3 py-3 shadow-none focus-visible:border-0 focus-visible:ring-0"
        placeholder="On a phone, open the pricing page, check every plan shows a price and a button, and look for text that is cut off"
        @keydown="writeFromKeys"
      />
      <div class="flex items-center gap-3 border-t px-3 py-2">
        <p class="min-w-0 flex-1 text-xs text-muted-foreground">
          {{ writerWords }}
        </p>
        <Button size="sm" class="shrink-0" :disabled="!canWrite" @click="write">
          <SparklesIcon aria-hidden="true" />
          {{ writing ? "Writing…" : "Write the skill" }}
          <kbd
            class="ml-1 font-sans text-xs opacity-70 max-sm:hidden"
            aria-hidden="true"
            >⌘↵</kbd
          >
        </Button>
      </div>
    </div>

    <h2 class="mt-10 mb-2 text-xs font-medium text-faint">Or start from</h2>
    <div
      class="divide-y divide-border/60 overflow-hidden rounded-lg ring-1 ring-border"
    >
      <p v-if="templatesError !== null" class="px-4 py-3 text-sm text-fail">
        {{ templatesError }}
      </p>
      <template v-else-if="templates !== null">
        <template v-for="template in templates.templates" :key="template.id">
          <RouterLink
            v-if="editing.allowed"
            :to="composeSkillPath({ template: template.id })"
            :class="[ROW, ROW_LIVE]"
          >
            <span
              class="max-w-[60%] shrink-0 truncate font-medium max-sm:max-w-none max-sm:min-w-0 max-sm:flex-1 max-sm:shrink"
              >{{ template.label }}</span
            >
            <span
              class="min-w-0 flex-1 truncate text-muted-foreground max-sm:hidden"
              >{{ template.about }}</span
            >
            <SkillChip
              class="shrink-0"
              :tone="SAFETY_WORDS[template.fields.safety].tone"
              :label="SAFETY_WORDS[template.fields.safety].label"
            />
            <ChevronRightIcon
              class="size-4 shrink-0 text-faint"
              aria-hidden="true"
            />
          </RouterLink>
          <div v-else :class="[ROW, 'text-muted-foreground']">
            <span
              class="max-w-[60%] shrink-0 truncate font-medium max-sm:max-w-none max-sm:min-w-0 max-sm:flex-1 max-sm:shrink"
              >{{ template.label }}</span
            >
            <span class="min-w-0 flex-1 truncate max-sm:hidden">{{
              template.about
            }}</span>
            <SkillChip
              class="shrink-0"
              :tone="SAFETY_WORDS[template.fields.safety].tone"
              :label="SAFETY_WORDS[template.fields.safety].label"
            />
          </div>
        </template>
      </template>
      <template v-else>
        <div
          v-for="placeholder in 3"
          :key="placeholder"
          class="flex h-11 items-center px-4"
          aria-label="Reading the templates"
        >
          <Skeleton class="h-4 w-2/3" />
        </div>
      </template>

      <div>
        <button
          type="button"
          :class="[ROW, editing.allowed ? ROW_LIVE : 'text-muted-foreground']"
          :disabled="!editing.allowed"
          :aria-expanded="copyOpen"
          @click="copyOpen = !copyOpen"
        >
          <CopyIcon class="size-4 shrink-0" aria-hidden="true" />
          <span
            class="max-w-[60%] shrink-0 truncate font-medium max-sm:max-w-none max-sm:min-w-0 max-sm:flex-1 max-sm:shrink"
            >Copy an existing skill</span
          >
          <span
            class="min-w-0 flex-1 truncate text-muted-foreground max-sm:hidden"
            >Start from one you have and change it</span
          >
          <ChevronRightIcon
            class="size-4 shrink-0 text-faint transition-transform"
            :class="{ 'rotate-90': copyOpen }"
            aria-hidden="true"
          />
        </button>
        <div
          v-if="copyOpen && editing.allowed"
          class="flex flex-wrap items-end gap-3 border-t border-border/60 bg-muted/40 px-4 py-3"
        >
          <div class="grid min-w-0 flex-1 grid-cols-1 gap-1.5 sm:min-w-56">
            <Label :for="copyId" class="text-xs text-muted-foreground"
              >The skill to start from</Label
            >
            <Select v-model="copied">
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
          <Button variant="outline" :disabled="copied === ''" @click="copy()">
            <CopyIcon aria-hidden="true" />
            Copy it
          </Button>
        </div>
      </div>

      <RouterLink
        v-if="editing.allowed"
        :to="uploadSkillPath()"
        :class="[ROW, ROW_LIVE]"
      >
        <FileUpIcon class="size-4 shrink-0" aria-hidden="true" />
        <span
          class="max-w-[60%] shrink-0 truncate font-medium max-sm:max-w-none max-sm:min-w-0 max-sm:flex-1 max-sm:shrink"
          >Upload or paste a skill.yaml</span
        >
        <span
          class="min-w-0 flex-1 truncate text-muted-foreground max-sm:hidden"
          >A file you have, or its text</span
        >
        <ChevronRightIcon
          class="size-4 shrink-0 text-faint"
          aria-hidden="true"
        />
      </RouterLink>
      <div v-else :class="[ROW, 'text-muted-foreground']">
        <FileUpIcon class="size-4 shrink-0" aria-hidden="true" />
        <span
          class="max-w-[60%] shrink-0 truncate font-medium max-sm:max-w-none max-sm:min-w-0 max-sm:flex-1 max-sm:shrink"
          >Upload or paste a skill.yaml</span
        >
        <span class="min-w-0 flex-1 truncate"
          >A file you have, or its text</span
        >
      </div>
    </div>

    <p class="mt-6 text-xs text-faint">{{ whereItGoes }}</p>
  </div>
</template>
