<script setup lang="ts">
import {
  EllipsisIcon,
  ExternalLinkIcon,
  EyeIcon,
  LockIcon,
  RotateCcwIcon,
  SquareIcon,
  Trash2Icon,
} from "@lucide/vue";
import type { ICiStep, ISweepResult } from "@shared/types";
import { useTitle } from "@vueuse/core";
import { computed, ref, watch } from "vue";
import CiProperties from "@/components/CiProperties.vue";
import CiReport from "@/components/CiReport.vue";
import CiStatusNote from "@/components/CiStatusNote.vue";
import CiSteps from "@/components/CiSteps.vue";
import CleanupDialog from "@/components/CleanupDialog.vue";
import PageBar from "@/components/PageBar.vue";
import PermissionNote from "@/components/PermissionNote.vue";
import RetryDialog from "@/components/RetryDialog.vue";
import RunLog from "@/components/RunLog.vue";
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
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useCiActions } from "@/composables/useCiActions";
import { useCiDetail } from "@/composables/useCiDetail";
import { useClock } from "@/composables/useClock";
import { useMenuFocusReturn } from "@/composables/useMenuFocusReturn";
import { ciTitle } from "@/lib/ci";
import { ciListPath, ciLogUrl, runPath } from "@/lib/paths";
import { CI_STATUS_LOOKS } from "@/lib/status";
import { mayActOnPipeline } from "@/state/access";
import { ciOverview, ciPipelineWithNumber, isActiveCiStatus } from "@/state/ci";
import { runs } from "@/state/runs";
import type { IRetryDraft } from "@/types";

// A Bitbucket pipeline of the e2e tests: its log shows the tests as they finish, and once a step
// is over its test report shows the failures. A server console that CI sends its runs to also
// has the run itself, live: "Watch the run". Like the run page: its actions in the title bar
// (below `md` the outlined ones fold into a "⋯" menu), its properties in a right column from `lg`.

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
// One dialog per action: its trigger in the bar from `md` up, the "⋯" menu's item below that.
const stopOpen = ref(false);
const cleanupOpen = ref(false);
const { returnFocus } = useMenuFocusReturn("menuButton");

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
    stopOpen.value = false;
    cleanupOpen.value = false;
  },
  { immediate: true }
);

// The steps' test reports (a step whose tests did not run has none).
const reports = computed(() =>
  (detail.value?.reports ?? []).flatMap((entry) => {
    const step = steps.value.find(
      (candidate) => candidate.uuid === entry.stepUuid
    );
    return step === undefined || entry.report === null
      ? []
      : [{ step, report: entry.report }];
  })
);

// The tests of every report, for the tab's count.
const reportedTotal = computed(() =>
  reports.value.reduce((sum, entry) => sum + entry.report.total, 0)
);
const cleanable = computed(
  () =>
    pipeline.value !== undefined && !going.value && pipeline.value.env !== null
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
  <PageBar
    :crumbs="[{ label: 'CI', to: ciListPath() }]"
    :title="pipeline === undefined ? undefined : ciTitle(pipeline)"
  >
    <span class="font-mono text-xs font-normal text-faint tabular-nums"
      >#{{ number }}</span
    >
    {{ pipeline?.label }}
    <template v-if="pipeline !== undefined" #actions>
      <AlertDialog v-if="going" v-model:open="stopOpen">
        <AlertDialogTrigger as-child>
          <Button
            size="sm"
            variant="outline"
            class="max-md:hidden"
            :disabled="!mayAct"
          >
            <SquareIcon class="fill-current" aria-hidden="true" />
            Stop
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent @close-auto-focus="returnFocus">
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
              :class="buttonVariants({ variant: 'destructive', size: 'sm' })"
              @click="stopPipeline"
            >
              Stop pipeline
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Button v-else size="sm" :disabled="!mayAct" @click="requestRerun">
        <RotateCcwIcon aria-hidden="true" />
        Run again
      </Button>

      <CleanupDialog
        v-if="cleanable && pipeline.env !== null"
        v-model:open="cleanupOpen"
        class="max-md:hidden"
        :env="pipeline.env"
        :owner="`pipeline #${pipeline.number}`"
        compact
        :disabled="!mayAct"
        :perform="cleanupPipeline"
        @close-auto-focus="returnFocus"
      />
      <Button
        v-if="followed !== undefined"
        size="sm"
        variant="outline"
        class="max-md:hidden"
        as-child
      >
        <RouterLink :to="runPath(followed.id)">
          <EyeIcon aria-hidden="true" />
          Watch the run
        </RouterLink>
      </Button>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            size="icon-sm"
            variant="outline"
            class="max-md:hidden"
            as="a"
            :href="pipeline.url"
            target="_blank"
            rel="noopener"
          >
            <ExternalLinkIcon aria-hidden="true" />
            <span class="sr-only">Open in Bitbucket</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Open in Bitbucket</TooltipContent>
      </Tooltip>

      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button
            ref="menuButton"
            size="icon-sm"
            variant="outline"
            class="md:hidden"
            aria-label="More actions"
          >
            <EllipsisIcon aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="w-56">
          <DropdownMenuItem
            v-if="going"
            :disabled="!mayAct"
            @select="stopOpen = true"
          >
            <SquareIcon class="fill-current" aria-hidden="true" />
            Stop…
          </DropdownMenuItem>
          <DropdownMenuItem
            v-if="cleanable"
            :disabled="!mayAct"
            @select="cleanupOpen = true"
          >
            <Trash2Icon aria-hidden="true" />
            Clean up…
          </DropdownMenuItem>
          <DropdownMenuItem v-if="followed !== undefined" as-child>
            <RouterLink :to="runPath(followed.id)">
              <EyeIcon aria-hidden="true" />
              Watch the run
            </RouterLink>
          </DropdownMenuItem>
          <DropdownMenuItem as-child>
            <a :href="pipeline.url" target="_blank" rel="noopener">
              <ExternalLinkIcon aria-hidden="true" />
              Open in Bitbucket
            </a>
          </DropdownMenuItem>
          <template v-if="acting !== null && !mayAct && acting.reason !== null">
            <DropdownMenuSeparator />
            <DropdownMenuLabel
              class="flex items-start gap-1.5 text-xs font-normal text-muted-foreground"
            >
              <LockIcon class="mt-0.5 size-3 shrink-0" aria-hidden="true" />
              {{ acting.reason }}
            </DropdownMenuLabel>
          </template>
        </DropdownMenuContent>
      </DropdownMenu>
    </template>
  </PageBar>

  <div v-if="pipeline !== undefined" class="flex min-h-0 flex-1">
    <div class="min-w-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
      <PermissionNote v-if="acting !== null" :permission="acting" />
      <p v-if="error !== null" class="text-sm text-fail">{{ error }}</p>

      <!-- Below `lg` the properties have no column of their own: they come before the steps. -->
      <CiProperties
        :pipeline="pipeline"
        :run="followed"
        :now="nowMs"
        class="border-b pb-5 lg:hidden"
      />

      <CiSteps
        v-if="steps.length > 0"
        :steps="steps"
        :selected="logStep?.uuid ?? null"
        :now="nowMs"
        @select="showLog"
      />
      <Skeleton
        v-else-if="detail === null && error === null"
        class="h-8 w-full max-w-md"
      />

      <Tabs v-model="tab">
        <TabsList>
          <TabsTrigger value="tests">
            Tests
            <span
              v-if="reportedTotal > 0"
              class="tabular-nums text-muted-foreground"
              >{{ reportedTotal }}</span
            >
          </TabsTrigger>
          <TabsTrigger value="log">Log</TabsTrigger>
        </TabsList>
        <TabsContent value="tests" class="mt-3 space-y-6">
          <div
            v-for="entry in reports"
            :key="entry.step.uuid"
            class="space-y-3"
          >
            <h2 v-if="reports.length > 1" class="text-sm font-medium">
              {{ entry.step.name }}
            </h2>
            <CiReport :report="entry.report" />
          </div>
          <p
            v-if="detail !== null && reports.length === 0"
            class="text-sm text-faint"
          >
            {{
              going
                ? "The test report comes when the step ends: until then, the log shows each test as it finishes."
                : "No test report: the tests did not run (a newer deploy was being tested, or the step ended first)."
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
    </div>

    <aside
      aria-label="Properties"
      class="hidden w-[260px] shrink-0 overflow-y-auto border-l px-5 py-5 lg:block"
    >
      <CiProperties :pipeline="pipeline" :run="followed" :now="nowMs" />
    </aside>

    <RetryDialog
      v-model:open="rerunOpen"
      :draft="rerunDraft"
      :environment="pipeline.guardedEnv ?? ''"
      @confirm="confirmRerun"
    />
  </div>

  <template v-else>
    <!-- Not set up, still asking, or Bitbucket's error or rate limit; then that it is not there. -->
    <CiStatusNote
      v-if="
        ciOverview === null ||
        !ciOverview.configured ||
        ciOverview.pausedUntil !== null ||
        ciOverview.error !== null
      "
      :overview="ciOverview"
    />
    <p
      v-if="ciOverview !== null && ciOverview.configured"
      class="px-6 py-16 text-center text-sm text-faint"
    >
      No pipeline #{{ number }}: the console shows the latest e2e pipelines
      only.
    </p>
  </template>
</template>
