<script setup lang="ts">
import { CameraIcon, LoaderCircleIcon, PaperclipIcon } from "@lucide/vue";
import type { IRunRecord, IRunState, IStepState } from "@shared/types";
import { computed, ref, watch } from "vue";
import {
  agentReport,
  agentTest,
  reportBody,
  spendDetail,
  verdictLine,
} from "@/lib/agent-check";
import { elapsed, formatDuration } from "@/lib/format";
import { hideBroken, showLoaded } from "@/lib/images";
import { isServedRunFile, runFileUrl } from "@/lib/paths";
import {
  RUN_STATUS_LOOKS,
  STEP_STATUS_LOOKS,
  TONE_CLASSES,
} from "@/lib/status";
import { consoleConfig } from "@/state/config";
import CopyButton from "./CopyButton.vue";
import StatusIcon from "./StatusIcon.vue";

// An agent check as it goes: what the agent does now (and how far it is into its limits), each
// step it took, the screenshots the skill saved (the newest large, the others to pick), and once
// it is over its verdict, its report and what it spent.

const props = defineProps<{
  run: IRunRecord;
  state: IRunState;
  now: number;
  finished: boolean;
  filesAllowed: boolean;
}>();

const test = computed(() => agentTest(props.state));
const steps = computed(() => test.value?.steps ?? []);
const current = computed(() =>
  steps.value.find((step) => step.stepId === test.value?.currentStepId)
);
const going = computed(
  () => !props.finished && test.value?.status === "running"
);
const report = computed(() =>
  test.value === undefined ? null : agentReport(test.value)
);
const body = computed(() =>
  report.value === null ? "" : reportBody(report.value)
);
const look = computed(() => RUN_STATUS_LOOKS[props.run.status]);
const verdict = computed(() =>
  verdictLine(props.run, test.value, report.value)
);
const limits = computed(() => consoleConfig.value?.agents.limits ?? null);
const usage = computed(() => props.run.agent?.usage ?? null);

const ranFor = computed(() => {
  const startedAt = test.value?.startedAt ?? null;
  return startedAt === null
    ? ""
    : formatDuration(elapsed(startedAt, null, props.now));
});
const budget = computed(() =>
  limits.value === null || limits.value.budgetSeconds === 0
    ? null
    : formatDuration(limits.value.budgetSeconds * 1000)
);

// The screenshots, oldest first; the one picked shows large (none picked: the newest).
const shots = computed(() => test.value?.shots ?? []);
const picked = ref<string | null>(null);
const shown = computed(
  () =>
    shots.value.find((shot) => shot.path === picked.value) ?? shots.value.at(-1)
);
watch(
  () => props.run.id,
  () => {
    picked.value = null;
  }
);

function shotUrl(shot: { path: string; seq: number }): string {
  return `${runFileUrl(props.run.id, shot.path)}?v=${shot.seq}`;
}

function stepTitle(stepId: string | null): string {
  return steps.value.find((step) => step.stepId === stepId)?.title ?? "";
}

// Steps that saved a screenshot point at it.
const shotOfStep = computed(
  () => new Map(shots.value.map((shot) => [shot.stepId, shot.path]))
);

function duration(step: IStepState): string {
  if (step.ms !== null) {
    return formatDuration(step.ms);
  }
  return step.status === "running"
    ? formatDuration(elapsed(step.startedAt, null, props.now))
    : "";
}

// Files beside the transcript (the screenshots show above).
const files = computed(() =>
  props.filesAllowed
    ? (test.value?.attachments ?? []).filter(
        (file) => isServedRunFile(file.path) && !file.path.endsWith(".png")
      )
    : []
);
</script>

<template>
  <div class="space-y-6">
    <section
      class="rounded-lg border bg-card px-5 py-4"
      :aria-label="going ? 'What the agent does now' : 'Verdict'"
    >
      <template v-if="going">
        <div class="flex items-start gap-3">
          <LoaderCircleIcon
            class="mt-0.5 size-5 shrink-0 text-run motion-safe:animate-spin"
            aria-hidden="true"
          />
          <div class="min-w-0 flex-1 space-y-1">
            <p class="text-base font-medium break-words">
              {{ current?.title ?? "The model is deciding what to do next" }}
            </p>
            <p class="text-sm text-muted-foreground tabular-nums">
              Step {{ steps.length }} · {{ ranFor }}
              <template v-if="budget !== null">of {{ budget }}</template>
              <template v-if="limits !== null && limits.maxTurns > 0">
                · stops after {{ limits.maxTurns }} model turns</template
              >
            </p>
          </div>
        </div>
      </template>
      <template v-else>
        <div class="flex items-start gap-3">
          <component
            :is="look.icon"
            class="mt-0.5 size-5 shrink-0"
            :class="TONE_CLASSES[look.tone].text"
            aria-hidden="true"
          />
          <div class="min-w-0 flex-1 space-y-1">
            <p
              class="text-base font-semibold"
              :class="TONE_CLASSES[look.tone].text"
            >
              {{ look.label }}
            </p>
            <p
              v-if="verdict !== null"
              class="text-sm break-words whitespace-pre-line"
            >
              {{ verdict }}
            </p>
            <p v-if="usage !== null" class="text-sm text-muted-foreground">
              Spent {{ spendDetail(usage) }}.
            </p>
          </div>
        </div>
      </template>
    </section>

    <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      <section class="min-w-0" aria-label="Steps">
        <h2 class="mb-2 text-sm font-medium text-muted-foreground">
          Steps the agent took
        </h2>
        <ol v-if="steps.length > 0" class="space-y-0.5 text-sm">
          <li
            v-for="(step, index) in steps"
            :key="step.stepId"
            class="flex items-start gap-2 rounded-md px-2 py-1"
            :class="step.stepId === current?.stepId ? 'bg-run/10' : ''"
          >
            <span
              class="mt-px w-6 shrink-0 text-right text-xs text-muted-foreground tabular-nums"
              >{{ index + 1 }}</span
            >
            <StatusIcon
              :look="STEP_STATUS_LOOKS[step.status]"
              class="mt-0.5 size-3.5"
            />
            <div class="min-w-0 flex-1">
              <p class="break-words">
                {{ step.title }}
                <span
                  v-if="step.note !== null"
                  class="ml-1 rounded-sm bg-muted px-1 py-px font-mono text-xs text-muted-foreground"
                  title="The command exited with a non-zero code: its output is the agent's to read, the step did not fail"
                  >{{ step.note }}</span
                >
              </p>
              <p
                v-if="step.error !== null"
                class="mt-0.5 line-clamp-3 font-mono text-xs break-words text-fail"
              >
                {{ step.error }}
              </p>
            </div>
            <button
              v-if="shotOfStep.has(step.stepId)"
              type="button"
              class="mt-0.5 shrink-0 rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
              :class="
                shown?.path === shotOfStep.get(step.stepId) ? 'text-run' : ''
              "
              :aria-label="`Show the screenshot of step ${index + 1}`"
              @click="picked = shotOfStep.get(step.stepId) ?? null"
            >
              <CameraIcon class="size-4" aria-hidden="true" />
            </button>
            <span
              class="w-14 shrink-0 text-right text-xs text-muted-foreground tabular-nums"
              >{{ duration(step) }}</span
            >
          </li>
        </ol>
        <p v-else class="text-sm text-muted-foreground">
          Hermes is getting ready: the steps show up as the agent takes them.
        </p>
      </section>

      <aside
        class="order-first min-w-0 space-y-3 lg:sticky lg:top-4 lg:order-none lg:self-start"
      >
        <h2 class="text-sm font-medium text-muted-foreground">Screenshots</h2>
        <figure v-if="shown !== undefined" class="space-y-1.5">
          <a
            :href="shotUrl(shown)"
            target="_blank"
            rel="noopener"
            class="block overflow-hidden rounded-md border bg-muted outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <!-- The whole page as saved: a tall one is scaled down, never cut. -->
            <img
              :src="shotUrl(shown)"
              :alt="`Screenshot: ${stepTitle(shown.stepId)}`"
              class="max-h-[70vh] w-full object-contain object-top"
              @error="hideBroken"
              @load="showLoaded"
            />
          </a>
          <figcaption class="text-xs text-muted-foreground">
            {{ stepTitle(shown.stepId) }}
          </figcaption>
        </figure>
        <p
          v-else
          class="grid aspect-[16/10] place-items-center rounded-md border border-dashed px-4 text-center text-sm text-muted-foreground"
        >
          The skill's screenshots show here as it saves them.
        </p>
        <ul v-if="shots.length > 1" class="grid grid-cols-4 gap-2">
          <li v-for="shot in shots" :key="shot.path">
            <button
              type="button"
              class="block w-full overflow-hidden rounded-sm border bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              :class="shown?.path === shot.path ? 'ring-2 ring-run' : ''"
              :aria-label="`Show: ${stepTitle(shot.stepId)}`"
              :aria-pressed="shown?.path === shot.path"
              @click="picked = shot.path"
            >
              <img
                :src="shotUrl(shot)"
                alt=""
                class="aspect-[16/10] w-full object-contain"
                loading="lazy"
                @error="hideBroken"
                @load="showLoaded"
              />
            </button>
          </li>
        </ul>
        <ul v-if="files.length > 0" class="space-y-1 text-sm">
          <li v-for="file in files" :key="file.path">
            <a
              :href="runFileUrl(run.id, file.path)"
              target="_blank"
              rel="noopener"
              class="inline-flex items-center gap-1.5 rounded-sm text-run underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <PaperclipIcon class="size-3.5" aria-hidden="true" />
              {{ file.name }}
            </a>
          </li>
        </ul>
      </aside>
    </div>

    <section v-if="body !== ''" aria-label="The agent's report">
      <div class="mb-2 flex items-center gap-1">
        <h2 class="text-sm font-medium text-muted-foreground">
          The agent's report
        </h2>
        <CopyButton :text="report ?? ''" label="Copy the report" />
      </div>
      <p
        class="max-w-3xl rounded-lg border bg-card px-5 py-4 text-sm leading-relaxed break-words whitespace-pre-line"
      >
        {{ body }}
      </p>
    </section>
  </div>
</template>
