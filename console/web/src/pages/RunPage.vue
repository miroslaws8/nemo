<script setup lang="ts">
import type { IRetryScope, ITestState } from "@shared/types";
import { useTitle } from "@vueuse/core";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import PageBar from "@/components/PageBar.vue";
import CiSilence from "@/components/CiSilence.vue";
import RetryDialog from "@/components/RetryDialog.vue";
import RunActions from "@/components/RunActions.vue";
import RunLog from "@/components/RunLog.vue";
import RunNotices from "@/components/RunNotices.vue";
import PermissionNote from "@/components/PermissionNote.vue";
import AuthorDraftPanel from "@/components/AuthorDraftPanel.vue";
import AgentCheckView from "@/components/AgentCheckView.vue";
import RunProgress from "@/components/RunProgress.vue";
import RunProperties from "@/components/RunProperties.vue";
import RunSummary from "@/components/RunSummary.vue";
import TestList from "@/components/TestList.vue";
import WorkerLanes from "@/components/WorkerLanes.vue";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useClock } from "@/composables/useClock";
import { useRunActions } from "@/composables/useRunActions";
import { formatLabel, plural } from "@/lib/format";
import { ciPath, runLogUrl, runPath } from "@/lib/paths";
import {
  cleanable,
  failedTests,
  hasReport,
  neededTiers,
  originOf,
  runKindOf,
  selectableTests,
  touchesData,
} from "@/lib/run-facts";
import {
  isActiveStatus,
  isFinishedStatus,
  RUN_STATUS_LOOKS,
} from "@/lib/status";
import { mayActOn, mayReadFilesOf } from "@/state/access";
import { isGuarded } from "@/state/config";
import { activeCiOn } from "@/state/ci";
import { activeRunOn, runsLoaded, runWithId } from "@/state/runs";
import { followRun, liveReady, liveRun } from "@/state/stream";
import { settleRun } from "@shared/reducer";
import type { IRetryDraft, IRunKindChoice } from "@/types";

// A run, live while it goes: counts, what each worker does now, every test with its steps and
// errors, the log, and the buttons to stop, retry and clean up.

const props = defineProps<{ id: string }>();

const nowMs = useClock();
const { retry } = useRunActions();

watch(() => props.id, followRun, { immediate: true });
onBeforeUnmount(() => followRun(null));

const run = computed(() => runWithId(props.id));
// The YAML tests, or an agent check: what the page shows of it.
const kind = computed<IRunKindChoice>(() =>
  run.value === undefined ? "tests" : runKindOf(run.value)
);

// A run that ended without "run.end" (force-stopped, crashed) leaves tests "running": once its
// events are in and its record is final, what was going counts as stopped.
watch(
  [liveReady, () => run.value?.status],
  ([ready, status]) => {
    if (ready && status !== undefined && isFinishedStatus(status)) {
      settleRun(liveRun);
    }
  },
  { immediate: true }
);
const going = computed(
  () => run.value !== undefined && isActiveStatus(run.value.status)
);
const finished = computed(
  () => run.value !== undefined && isFinishedStatus(run.value.status)
);
const failed = computed(() =>
  run.value === undefined ? [] : failedTests(run.value, liveRun)
);
// Tests that really failed (not only stopped or never started) make it a retry.
const failedLabel = computed(() =>
  failed.value.some(
    (test) => test.status === "failed" || test.status === "timedOut"
  )
    ? "Retry failed"
    : "Run the rest"
);
// Prod's reports and traces (they hold session tokens) and its buttons take an operator.
const reading = computed(() =>
  run.value === undefined ? null : mayReadFilesOf(run.value.env)
);
const filesAllowed = computed(() => reading.value?.allowed === true);
const acting = computed(
  () => run.value !== undefined && mayActOn(run.value.env).allowed
);
// Why the title bar's buttons are greyed out (a CI run's are its pipeline's page's).
const actPermission = computed(() =>
  run.value === undefined || originOf(run.value) === "ci"
    ? null
    : mayActOn(run.value.env)
);
const reportMade = computed(
  () => run.value !== undefined && hasReport(run.value, liveRun)
);
const report = computed(() => reportMade.value && filesAllowed.value);
const leftData = computed(
  () => run.value !== undefined && touchesData(run.value, liveRun)
);
const mayClean = computed(
  () => run.value !== undefined && cleanable(run.value, liveRun)
);
// The first tab: the tests of a run, or what an agent check did.
const TAB_LABELS: Record<IRunKindChoice, string> = {
  tests: "Tests",
  agent: "Check",
  author: "Test",
};
// What lists a run's tests: Playwright, or Hermes for an agent check.
const STARTERS: Record<IRunKindChoice, string> = {
  tests: "Playwright",
  agent: "Hermes",
  author: "the author",
};
// What a run without tests yet is doing.
const waitingWords = computed(() => {
  const record = run.value;
  if (record?.status === "preparing") {
    return `Getting ${record.ref ?? "the tests"} at ${
      record.sha?.slice(0, 7) ?? "its commit"
    } ready: its files, its packages and its browser (the first run of a new lockfile or Playwright version installs them).`;
  }
  const starter = STARTERS[kind.value];
  return going.value
    ? `${starter} is starting: the tests show up once it has listed them.`
    : `This run ended before ${starter} listed its tests. The log says why.`;
});
const blocker = computed(() =>
  run.value === undefined ? undefined : activeRunOn(run.value.env)
);
// A CI step about to test the environment goes first (it asked for it: ci/ingest.mts wait).
const ciBlocker = computed(() =>
  run.value === undefined ? undefined : activeCiOn(run.value.env)
);
// What a stopping run waits for before it is over.
const stoppingWords = computed(() =>
  leftData.value
    ? "Stopping: the tests delete their data first. This can take up to 3 minutes."
    : "Stopping: waiting for the browsers to close."
);
// A run of tests takes itself apart in a Summary tab, first, and a page that opens on it once it
// is over opens on that tab. One that ends while the page is open stays on the tab shown.
const HAS_SUMMARY: Record<IRunKindChoice, boolean> = {
  tests: true,
  agent: false,
  author: false,
};
const showsSummary = computed(() => HAS_SUMMARY[kind.value]);
// Whether the run was over when the page first knew it (its record), per run the page shows.
const openedOver = ref<{ id: string; over: boolean } | null>(null);
watch(
  [() => props.id, () => run.value?.status],
  ([id, status]) => {
    if (status !== undefined && openedOver.value?.id !== id) {
      openedOver.value = { id, over: isFinishedStatus(status) };
    }
  },
  { immediate: true }
);
// The tab the person picked on this run (null: the default one).
const chosenTab = ref<string | null>(null);
const tab = computed<string>({
  get: () => {
    const openedOnSummary =
      openedOver.value?.id === props.id && openedOver.value.over;
    const fallback =
      showsSummary.value && openedOnSummary ? "summary" : "tests";
    const chosen = chosenTab.value;
    return chosen === null || (chosen === "summary" && !showsSummary.value)
      ? fallback
      : chosen;
  },
  set: (value) => {
    chosenTab.value = value;
  },
});
// The test the Summary opened in the Tests tab (only while that tab is shown).
const openTestId = ref<string | null>(null);
watch(
  () => props.id,
  () => {
    chosenTab.value = null;
    openTestId.value = null;
  }
);
watch(tab, (shown) => {
  if (shown !== "tests") {
    openTestId.value = null;
  }
});

function openTest(testId: string): void {
  openTestId.value = testId;
  chosenTab.value = "tests";
}

useTitle(
  computed(() =>
    run.value === undefined
      ? "QA Console"
      : `${RUN_STATUS_LOOKS[run.value.status].label} · ${formatLabel(
          run.value.selection.label
        )} — QA Console`
  )
);

const retryOpen = ref(false);
const retryDraft = ref<IRetryDraft | null>(null);

/** The tests a retry of this scope takes, as the server will choose them. */
function testsFor(scope: IRetryScope, testIds: string[] | null): ITestState[] {
  const record = run.value;
  if (record === undefined) {
    return [];
  }
  const all = selectableTests(liveRun);
  const chosen = record.selection.testIds;
  const strategies: Record<IRetryScope, () => ITestState[]> = {
    test: () => all.filter((test) => testIds?.includes(test.testId) === true),
    failed: () => failedTests(record, liveRun),
    all: () =>
      chosen === null
        ? all
        : all.filter((test) => chosen.includes(test.testId)),
  };
  return strategies[scope]();
}

function describeRetry(
  scope: IRetryScope,
  count: number,
  title: string
): string {
  const titles: Record<IRetryScope, string> = {
    test: `Retry “${title}”`,
    failed: `${failedLabel.value}: ${plural(count, "test", "tests")}`,
    all: "Run all again",
  };
  return titles[scope];
}

/** Retries at once, or asks first when there is a choice to make. */
async function requestRetry(
  scope: IRetryScope,
  testIds: string[] | null
): Promise<void> {
  const record = run.value;
  if (record === undefined || !acting.value) {
    return;
  }
  const tests = testsFor(scope, testIds);
  // A full rerun of the profile brings its needed tiers along by itself.
  const fullRerun = scope === "all" && record.selection.testIds === null;
  const needTiers = fullRerun ? [] : neededTiers(tests);
  const guarded = isGuarded(record.env);
  if (needTiers.length === 0 && !guarded) {
    await retry(record, testIds === null ? { scope } : { scope, testIds });
    return;
  }
  retryDraft.value = {
    scope,
    testIds,
    title: describeRetry(scope, tests.length, tests[0]?.title ?? ""),
    description: `On ${record.env}, ${record.profile} profile. The login runs first, as always.`,
    needTiers,
    guarded,
  };
  retryOpen.value = true;
}

async function confirmRetry(options: {
  skipNeeds: boolean;
  confirm: string | undefined;
}): Promise<void> {
  const record = run.value;
  const draft = retryDraft.value;
  if (record === undefined || draft === null) {
    return;
  }
  const started = await retry(record, {
    scope: draft.scope,
    ...(draft.testIds === null ? {} : { testIds: draft.testIds }),
    ...(draft.needTiers.length > 0 ? { skipNeeds: options.skipNeeds } : {}),
    ...(options.confirm === undefined ? {} : { confirm: options.confirm }),
  });
  if (started) {
    retryOpen.value = false;
  }
}
</script>

<template>
  <PageBar
    :crumbs="[{ label: 'Runs', to: '/' }]"
    :title="run === undefined ? undefined : formatLabel(run.selection.label)"
  >
    {{ run === undefined ? "Run" : formatLabel(run.selection.label) }}
    <template v-if="run !== undefined" #actions>
      <RunActions
        :run="run"
        :failed-count="failed.length"
        :failed-label="failedLabel"
        :has-report="report"
        :cleanable="mayClean"
        @retry="requestRetry($event, null)"
      />
    </template>
  </PageBar>

  <div v-if="run !== undefined" class="flex min-h-0 flex-1">
    <div class="min-w-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
      <p
        v-if="run.status === 'stopping' && actPermission !== null"
        class="text-sm text-muted-foreground"
      >
        {{ stoppingWords }}
      </p>
      <PermissionNote
        v-if="actPermission !== null"
        :permission="actPermission"
      />
      <PermissionNote
        v-if="reportMade && reading !== null"
        :permission="reading"
      />

      <p v-if="run.status === 'queued'" class="text-sm text-muted-foreground">
        <template v-if="blocker !== undefined">
          Waits for
          <RouterLink
            :to="runPath(blocker.id)"
            class="text-run underline-offset-2 hover:underline"
            >{{ formatLabel(blocker.selection.label) }}</RouterLink
          >
          to finish: {{ run.env }} takes one run at a time, since every run
          there uses the same QA account.
        </template>
        <template v-else-if="ciBlocker !== undefined">
          Waits for
          <RouterLink
            :to="ciPath(ciBlocker.number)"
            class="text-run underline-offset-2 hover:underline"
            >CI pipeline #{{ ciBlocker.number }}</RouterLink
          >: it tests {{ run.env }} first, with the same QA account.
        </template>
        <template v-else>
          Starts as soon as one of the console's run slots is free.
        </template>
      </p>

      <template v-else-if="!liveReady">
        <Skeleton class="h-1 w-full rounded-full" />
        <div class="space-y-2">
          <Skeleton class="h-8 w-full" />
          <Skeleton class="h-8 w-full" />
          <Skeleton class="h-8 w-2/3" />
        </div>
      </template>

      <template v-else>
        <p
          v-if="liveRun.counts.total === 0"
          class="text-sm text-muted-foreground"
        >
          {{ waitingWords }}
        </p>
        <RunProgress
          v-else-if="kind === 'tests'"
          :counts="liveRun.counts"
          :finished="finished"
        />

        <RunNotices :state="liveRun" :going="going" />
        <CiSilence :run="run" :state="liveRun" :going="going" :now="nowMs" />

        <ul v-if="liveRun.runErrors.length > 0" class="space-y-2">
          <li
            v-for="(message, index) in liveRun.runErrors"
            :key="index"
            class="rounded-md border border-fail/30 bg-fail/5 px-4 py-3 font-mono text-xs whitespace-pre-wrap text-fail"
          >
            {{ message }}
          </li>
        </ul>

        <WorkerLanes
          v-if="kind === 'tests' && going && liveRun.phase === 'running'"
          :run-id="run.id"
          :state="liveRun"
          :now="nowMs"
        />
      </template>

      <!-- Below `lg` the properties have no column of their own: they come before the tabs. -->
      <RunProperties :run="run" :now="nowMs" class="border-b pb-5 lg:hidden" />

      <Tabs v-if="run.status !== 'queued'" v-model="tab">
        <TabsList>
          <TabsTrigger v-if="showsSummary" value="summary">Summary</TabsTrigger>
          <TabsTrigger value="tests">
            {{ TAB_LABELS[kind] }}
            <span
              v-if="kind === 'tests'"
              class="tabular-nums text-muted-foreground"
              >{{ liveRun.counts.total }}</span
            >
          </TabsTrigger>
          <TabsTrigger value="log">Log</TabsTrigger>
        </TabsList>
        <TabsContent v-if="showsSummary" value="summary" class="mt-4">
          <RunSummary
            v-if="liveReady"
            :key="run.id"
            :state="liveRun"
            :now="nowMs"
            :going="going"
            @open="openTest"
          />
        </TabsContent>
        <TabsContent value="tests" class="mt-3 grid gap-4">
          <AuthorDraftPanel
            v-if="kind === 'author'"
            :key="`author-${run.id}`"
            :run="run"
            :finished="finished"
          />
          <AgentCheckView
            v-if="liveReady && kind === 'agent'"
            :key="run.id"
            :run="run"
            :state="liveRun"
            :now="nowMs"
            :finished="finished"
            :files-allowed="filesAllowed"
          />
          <TestList
            v-else-if="liveReady"
            :key="run.id"
            :run-id="run.id"
            :state="liveRun"
            :now="nowMs"
            :finished="finished"
            :can-retry="finished && acting"
            :has-report="report"
            :files-allowed="filesAllowed"
            :open-test-id="openTestId"
            @retry-test="requestRetry('test', [$event])"
          />
        </TabsContent>
        <TabsContent value="log" class="mt-3">
          <RunLog
            :url="runLogUrl(run.id)"
            :going="going"
            :visible="tab === 'log'"
          />
        </TabsContent>
      </Tabs>
    </div>

    <aside
      aria-label="Properties"
      class="hidden w-[260px] shrink-0 overflow-y-auto border-l px-5 py-5 lg:block"
    >
      <RunProperties :run="run" :now="nowMs" />
    </aside>

    <RetryDialog
      v-model:open="retryOpen"
      :draft="retryDraft"
      :environment="run.env"
      @confirm="confirmRetry"
    />
  </div>

  <div
    v-else-if="runsLoaded"
    class="px-6 py-5 text-center text-sm text-muted-foreground"
  >
    <p class="text-base font-medium text-foreground">No run {{ id }}</p>
    <p class="mt-1">
      It may have been removed with older runs.
      <RouterLink to="/" class="text-run underline-offset-2 hover:underline"
        >See what is going on</RouterLink
      >
    </p>
  </div>

  <div v-else class="space-y-4 px-6 py-5">
    <Skeleton class="h-5 w-80" />
    <Skeleton class="h-1 w-full rounded-full" />
    <Skeleton class="h-8 w-full" />
  </div>
</template>
