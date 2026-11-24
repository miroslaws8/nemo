<script setup lang="ts">
import type { IAuthorAnswer, IRunRecord } from "@shared/types";
import { authorAnswerSchema, saveTestAnswerSchema } from "@shared/api";
import { CheckIcon, FilePlusIcon, RotateCcwIcon, XIcon } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import { toast } from "vue-sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useRunActions } from "@/composables/useRunActions";
import { getJson, messageOf, postJson } from "@/lib/api";
import { mayActOn } from "@/state/access";
import { consoleConfig } from "@/state/config";

// A test written with AI: what came of it (outcome, verification), the draft's YAML, and adding
// it to the tests (a local console writes it into the working tree).

const props = defineProps<{ run: IRunRecord; finished: boolean }>();

const answer = ref<IAuthorAnswer | null>(null);
const failure = ref<string | null>(null);
const saving = ref(false);
const savedAs = ref<string | null>(null);
const { retry } = useRunActions();

const OUTCOME_WORDS: Record<"done" | "impossible" | "incomplete", string> = {
  done: "Written",
  impossible: "Not possible",
  incomplete: "Not finished",
};

async function load(): Promise<void> {
  try {
    answer.value = await getJson(
      `/api/runs/${encodeURIComponent(props.run.id)}/author`,
      authorAnswerSchema
    );
    failure.value = null;
  } catch (error) {
    failure.value = messageOf(error);
  }
}

watch(
  () => [props.run.id, props.finished] as const,
  () => {
    savedAs.value = null;
    if (props.finished) {
      void load();
    }
  },
  { immediate: true }
);

const result = computed(() => answer.value?.result ?? null);
const verified = computed(() => result.value?.verification?.verified === true);
const authoring = computed(() => consoleConfig.value?.authoring ?? null);
const canSave = computed(
  () =>
    verified.value &&
    answer.value?.draft !== null &&
    authoring.value?.available === true &&
    mayActOn(props.run.env).allowed &&
    savedAs.value === null
);

async function save(): Promise<void> {
  saving.value = true;
  try {
    const saved = await postJson(
      `/api/runs/${encodeURIComponent(props.run.id)}/author/save`,
      {},
      saveTestAnswerSchema
    );
    savedAs.value = saved.file;
    toast.success(`Added: ${saved.file}`);
  } catch (error) {
    toast.error(messageOf(error));
  } finally {
    saving.value = false;
  }
}

async function again(): Promise<void> {
  await retry(props.run, { scope: "all" });
}
</script>

<template>
  <section class="grid gap-3 rounded-md border p-4">
    <p class="text-sm text-muted-foreground">
      <span class="font-medium text-foreground">What to check:</span>
      {{ run.author?.goal }}
    </p>

    <p v-if="!finished" class="text-sm text-muted-foreground">
      The AI is walking it; its steps show below as it goes.
    </p>
    <Skeleton v-else-if="answer === null && failure === null" class="h-24" />
    <p v-else-if="failure !== null" class="text-sm text-fail">{{ failure }}</p>
    <p v-else-if="result === null" class="text-sm text-fail">
      The run wrote no result: see its log.
    </p>

    <template v-else>
      <div class="flex flex-wrap items-center gap-2 text-sm">
        <span class="font-medium">{{ OUTCOME_WORDS[result.outcome] }}</span>
        <span class="text-muted-foreground">— {{ result.summary }}</span>
      </div>
      <p
        v-if="result.verification !== null"
        class="flex items-center gap-1.5 text-sm"
        :class="result.verification.verified ? 'text-pass' : 'text-fail'"
      >
        <CheckIcon
          v-if="result.verification.verified"
          class="size-4"
          aria-hidden="true"
        />
        <XIcon v-else class="size-4" aria-hidden="true" />
        {{ result.verification.verified ? "Verified" : "Not verified" }}:
        {{ result.verification.why }}
      </p>

      <div v-if="answer?.draft" class="grid gap-2">
        <p class="text-xs text-muted-foreground">
          {{ answer.draft.file }} · {{ result.draft?.tier }}
          <template v-if="result.draft?.submitsForm">
            · writes data (runs only on {{ run.env }})</template
          >
        </p>
        <pre
          class="max-h-96 overflow-auto rounded-md bg-muted p-3 font-mono text-xs"
          >{{ answer.draft.yaml }}</pre
        >
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <Button
          v-if="answer?.draft"
          :disabled="!canSave || saving"
          @click="save"
        >
          <FilePlusIcon class="size-4" aria-hidden="true" />
          {{ savedAs === null ? "Add to tests" : "Added" }}
        </Button>
        <Button variant="outline" @click="again">
          <RotateCcwIcon class="size-4" aria-hidden="true" />
          Write it again
        </Button>
        <p v-if="savedAs !== null" class="text-xs text-muted-foreground">
          {{ savedAs }} — read it, then commit it.
        </p>
        <p
          v-else-if="answer?.draft && !verified"
          class="text-xs text-muted-foreground"
        >
          Only a verified draft is added.
        </p>
        <p
          v-else-if="authoring !== null && !authoring.available"
          class="text-xs text-muted-foreground"
        >
          {{ authoring.reason }}
        </p>
      </div>
    </template>
  </section>
</template>
