<script setup lang="ts">
import { ExternalLinkIcon, RotateCcwIcon, SquareIcon } from "@lucide/vue";
import type { ICiStep, ISweepResult } from "@shared/types";
import { useTitle } from "@vueuse/core";
import { computed, ref, watch } from "vue";
import CiReport from "@/components/CiReport.vue";
import CiStatusNote from "@/components/CiStatusNote.vue";
import CleanupDialog from "@/components/CleanupDialog.vue";
import PageBar from "@/components/PageBar.vue";
import PermissionNote from "@/components/PermissionNote.vue";
import RetryDialog from "@/components/RetryDialog.vue";
import RunLog from "@/components/RunLog.vue";
import StatusIcon from "@/components/StatusIcon.vue";
import StatusPill from "@/components/StatusPill.vue";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCiActions } from "@/composables/useCiActions";
import { useCiDetail } from "@/composables/useCiDetail";
import { useClock } from "@/composables/useClock";
import { ciCause, ciProfile, ciTitle } from "@/lib/ci";
import { elapsed, formatDuration, formatWhen } from "@/lib/format";
import { ciLogUrl, runPath } from "@/lib/paths";
import { CI_STATUS_LOOKS, CI_STEP_LOOKS } from "@/lib/status";
import { mayActOnPipeline } from "@/state/access";
import { ciOverview, ciPipelineWithNumber, isActiveCiStatus } from "@/state/ci";
import { runs } from "@/state/runs";
import type { IRetryDraft } from "@/types";

// A Bitbucket pipeline of the e2e tests: its log shows the tests as they finish, and once a step
// is over its test report shows the failures. A server console that CI sends its runs to also
// has the run itself, live: "Watch the run".

const props = defineProps<{ number: number }>();

const nowMs = useClock();
const { stop, rerun, cleanup } = useCiActions();

const pipeline = computed(() => ciPipelineWithNumber(props.number));
// The run CI sent the console for this pipeline, its latest try first.
const followed = computed(() =>
  runs.value.find((run) => run.ci?.number === props.number)
);
// Stop, run again and clean up take the role of the environment it touches (prod: an operator).
const acting = computed(() =>
  pipeline.value === undefined ? null : mayActOnPipeline(pipeline.value)
);
const mayAct = computed(() => acting.value?.allowed === true);
const going = computed(
  () => pipeline.value !== undefined && isActiveCiStatus(pipeline.value.status)
);
const { detail, error } = useCiDetail(
  () => props.number,
  () => pipeline.value?.status ?? null,
  going
);

const steps = computed(() => detail.value?.steps ?? []);
const chosenStep = ref<string | null>(null);
const tab = ref("tests");

// The log shows the step picked, else the one going, else the last one.
const logStep = computed(
  (): ICiStep | undefined =>
    steps.value.find((step) => step.uuid === chosenStep.value) ??
    steps.value.find((step) => step.status === "running") ??
    steps.value[steps.value.length - 1]
);

watch(
  () => props.number,
  () => {
    chosenStep.value = null;
    tab.value = going.value ? "log" : "tests";
  },
  { immediate: true }
);

const reports = computed(() =>
  (detail.value?.reports ?? []).flatMap((entry) => {
    const step = steps.value.find(
      (candidate) => candidate.uuid === entry.stepUuid
    );
    return step === undefined ? [] : [{ step, report: entry.report }];
  })
);

const duration = computed(() =>
  pipeline.value === undefined
    ? ""
    : formatDuration(
        elapsed(pipeline.value.createdAt, pipeline.value.endedAt, nowMs.value)
      )
);

useTitle(
  computed(() =>
    pipeline.value === undefined
      ? "QA Console"
      : `${CI_STATUS_LOOKS[pipeline.value.status].label} · ${ciTitle(
          pipeline.value
        )} — QA Console`
  )
);

function stepDuration(step: ICiStep): string {
  return step.startedAt === null
    ? ""
    : formatDuration(elapsed(step.startedAt, step.endedAt, nowMs.value));
}

function stopPipeline(): void {
  const current = pipeline.value;
  if (current !== undefined) {
    void stop(current);
  }
}

function cleanupPipeline(
  apply: boolean,
  confirm: string | undefined
): Promise<ISweepResult | null> {
  const current = pipeline.value;
  return current === undefined
    ? Promise.resolve(null)
    : cleanup(current, apply, confirm);
}

function showLog(step: ICiStep): void {
  chosenStep.value = step.uuid;
  tab.value = "log";
}

const rerunOpen = ref(false);
const rerunDraft = computed((): IRetryDraft | null =>
  pipeline.value === undefined
    ? null
    : {
        scope: "all",
        testIds: null,
        title: `Run ${ciTitle(pipeline.value)} again`,
        description: `A new ${pipeline.value.pattern} pipeline on ${
          pipeline.value.branch ?? "the same branch"
        }, with the same profile. It tests what is deployed now.`,
        needTiers: [],
        guarded: pipeline.value.guardedEnv !== null,
      }
);

async function requestRerun(): Promise<void> {
  const current = pipeline.value;
  if (current === undefined) {
    return;
  }
  if (current.guardedEnv !== null) {
    rerunOpen.value = true;
    return;
  }
  await rerun(current, undefined);
}

async function confirmRerun(options: {
  skipNeeds: boolean;
  confirm: string | undefined;
}): Promise<void> {
  const current = pipeline.value;
  if (current !== undefined && (await rerun(current, options.confirm))) {
    rerunOpen.value = false;
  }
}
</script>

<template>
  <PageBar>
    <span>{{
      pipeline === undefined ? `Pipeline #${number}` : ciTitle(pipeline)
    }}</span>
  </PageBar>

  <div v-if="pipeline !== undefined" class="space-y-6 px-6 py-5">
    <header class="flex flex-wrap items-start gap-x-8 gap-y-4">
      <div class="min-w-0 flex-[1_1_20rem] space-y-2">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
          <StatusPill :look="CI_STATUS_LOOKS[pipeline.status]" />
          <span class="text-xs text-muted-foreground">Bitbucket pipeline</span>
        </div>
        <h1 class="text-2xl font-semibold tracking-tight text-balance">
          {{ ciTitle(pipeline) }}
        </h1>
        <dl
          class="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground"
        >
          <div>
            <dt class="sr-only">Pipeline and branch</dt>
            <dd>
              <span class="font-mono text-xs">{{ pipeline.pattern }}</span>
              <template v-if="pipeline.branch !== null">
                on
                <span class="font-medium text-foreground">{{
                  pipeline.branch
                }}</span>
              </template>
            </dd>
          </div>
          <div v-if="ciProfile(pipeline) !== null" class="flex gap-1.5">
            <dt>Profile</dt>
            <dd>{{ ciProfile(pipeline) }}</dd>
          </div>
          <div>
            <dt class="sr-only">Started by</dt>
            <dd>{{ ciCause(pipeline) }}</dd>
          </div>
          <div class="flex gap-1.5">
            <dt>Started</dt>
            <dd class="tabular-nums">
              {{ formatWhen(pipeline.createdAt, nowMs) }}
            </dd>
          </div>
          <div class="flex gap-1.5">
            <dt>{{ going ? "Running for" : "Took" }}</dt>
            <dd class="tabular-nums">{{ duration }}</dd>
          </div>
        </dl>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <AlertDialog v-if="going">
          <AlertDialogTrigger as-child>
            <Button variant="outline" :disabled="!mayAct">
              <SquareIcon class="fill-current" aria-hidden="true" />
              Stop
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Stop {{ ciTitle(pipeline) }}?</AlertDialogTitle>
              <AlertDialogDescription>
                Bitbucket stops the step at once, so the tests cannot delete the
                data they created. Use Clean up afterwards to remove it.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep it going</AlertDialogCancel>
              <AlertDialogAction
                class="bg-destructive text-white hover:bg-destructive/90"
                @click="stopPipeline"
              >
                Stop pipeline
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <template v-else>
          <Button variant="outline" :disabled="!mayAct" @click="requestRerun">
            <RotateCcwIcon aria-hidden="true" />
            Run again
          </Button>
          <CleanupDialog
            v-if="pipeline.env !== null"
            :env="pipeline.env"
            :owner="`pipeline #${pipeline.number}`"
            :disabled="!mayAct"
            :perform="cleanupPipeline"
          />
        </template>
        <Button v-if="followed !== undefined" variant="outline" as-child>
          <RouterLink :to="runPath(followed.id)">Watch the run</RouterLink>
        </Button>
        <Button
          variant="outline"
          as="a"
          :href="pipeline.url"
          target="_blank"
          rel="noopener"
        >
          <ExternalLinkIcon aria-hidden="true" />
          Bitbucket
        </Button>
        <PermissionNote
          v-if="acting !== null"
          :permission="acting"
          class="w-full"
        />
      </div>
    </header>

    <p v-if="error !== null" class="text-sm text-fail">{{ error }}</p>

    <section v-if="steps.length > 0" aria-label="Steps">
      <ol class="divide-y overflow-hidden rounded-lg border bg-card">
        <li v-for="step in steps" :key="step.uuid">
          <button
            type="button"
            class="flex w-full items-center gap-3 px-4 py-2.5 text-left outline-none transition-colors hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
            :class="step.uuid === logStep?.uuid ? 'bg-accent/40' : ''"
            :aria-pressed="step.uuid === logStep?.uuid"
            @click="showLog(step)"
          >
            <StatusIcon :look="CI_STEP_LOOKS[step.status]" />
            <span class="min-w-0 flex-1 truncate text-sm font-medium">{{
              step.name
            }}</span>
            <span class="text-xs text-muted-foreground">{{
              CI_STEP_LOOKS[step.status].label
            }}</span>
            <span
              class="w-20 text-right text-xs tabular-nums text-muted-foreground"
              >{{ stepDuration(step) }}</span
            >
          </button>
        </li>
      </ol>
    </section>
    <div v-else-if="detail === null && error === null" class="space-y-2">
      <Skeleton class="h-11 w-full" />
    </div>

    <Tabs v-model="tab">
      <TabsList>
        <TabsTrigger value="tests">Tests</TabsTrigger>
        <TabsTrigger value="log">Log</TabsTrigger>
      </TabsList>
      <TabsContent value="tests" class="mt-3 space-y-6">
        <template v-for="entry in reports" :key="entry.step.uuid">
          <div v-if="entry.report !== null" class="space-y-2">
            <h2 v-if="reports.length > 1" class="text-sm font-medium">
              {{ entry.step.name }}
            </h2>
            <CiReport :report="entry.report" />
          </div>
        </template>
        <p
          v-if="reports.every((entry) => entry.report === null)"
          class="rounded-lg border border-dashed px-5 py-4 text-sm text-muted-foreground"
        >
          {{
            going
              ? "The test report comes when the step ends. Until then, the log shows each test as it finishes."
              : "No test report: the tests did not run in this pipeline (a newer deploy was already being tested, or the step ended before them)."
          }}
        </p>
      </TabsContent>
      <TabsContent value="log" class="mt-3">
        <RunLog
          v-if="logStep !== undefined"
          :url="ciLogUrl(pipeline.number, logStep.uuid)"
          :going="
            logStep.status === 'running' ||
            logStep.status === 'pending' ||
            logStep.status === 'ready'
          "
          :visible="tab === 'log'"
        />
      </TabsContent>
    </Tabs>

    <RetryDialog
      v-model:open="rerunOpen"
      :draft="rerunDraft"
      :environment="pipeline.guardedEnv ?? ''"
      @confirm="confirmRerun"
    />
  </div>

  <div v-else class="px-6 py-5">
    <CiStatusNote
      v-if="ciOverview === null || !ciOverview.configured"
      :overview="ciOverview"
    />
    <p v-else class="text-center text-sm text-muted-foreground">
      <span class="block text-base font-medium text-foreground"
        >No pipeline #{{ number }}</span
      >
      The console shows the latest e2e pipelines only.
    </p>
  </div>
</template>
