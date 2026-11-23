<script setup lang="ts">
import {
  ChevronDownIcon,
  ExternalLinkIcon,
  OctagonXIcon,
  RotateCcwIcon,
  SquareIcon,
  XIcon,
} from "@lucide/vue";
import type { IRunRecord, IRunStatus } from "@shared/types";
import { computed, ref } from "vue";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useRunActions } from "@/composables/useRunActions";
import {
  elapsed,
  formatDuration,
  formatLabel,
  formatTokens,
  formatUsd,
  formatWhen,
} from "@/lib/format";
import { ciPath, commitUrl, reportUrl, runPath, skillPath } from "@/lib/paths";
import { originOf, runKindOf } from "@/lib/run-facts";
import { isActiveStatus, RUN_STATUS_LOOKS } from "@/lib/status";
import { mayActOn } from "@/state/access";
import { STORE_WORDS } from "@/lib/skills";
import { consoleConfig } from "@/state/config";
import { runWithId } from "@/state/runs";
import type { IRunActionSet, IRunKindChoice, IRunOrigin } from "@/types";
import CleanupDialog from "./CleanupDialog.vue";
import CopyButton from "./CopyButton.vue";
import PermissionNote from "./PermissionNote.vue";
import StatusPill from "./StatusPill.vue";

const props = defineProps<{
  run: IRunRecord;
  now: number;
  failedCount: number;
  // "Retry failed", or "Run the rest" when nothing failed but tests were stopped or never ran.
  failedLabel: string;
  hasReport: boolean;
  touchesData: boolean;
  // Clean up may find data of it (its tests', or an agent check's skill's).
  cleanable: boolean;
}>();

const emit = defineEmits<{ retry: [scope: "failed" | "all"] }>();

// The buttons each status offers.
const ACTIONS: Record<IRunStatus, IRunActionSet> = {
  queued: "dequeue",
  preparing: "stop",
  starting: "stop",
  running: "stop",
  stopping: "force",
  passed: "finished",
  failed: "finished",
  interrupted: "finished",
  timedout: "finished",
  killed: "finished",
  crashed: "finished",
};

const { stop, cleanup } = useRunActions();
const sending = ref(false);
const forceOpen = ref(false);

// A CI run is stopped, run again and cleaned up from its pipeline's page.
const ORIGIN_ACTIONS: Record<
  IRunOrigin,
  (status: IRunStatus) => IRunActionSet
> = {
  console: (status) => ACTIONS[status],
  ci: () => "ci",
};

const actions = computed(() =>
  ORIGIN_ACTIONS[originOf(props.run)](props.run.status)
);
// Stop, retry and clean up take the role of the run's environment.
const acting = computed(() => mayActOn(props.run.env));
// The commit a server console tested, linked to its page where the repository has one.
const commit = computed(() => {
  const sha = props.run.sha;
  return sha === null
    ? null
    : {
        short: sha.slice(0, 7),
        url: commitUrl(consoleConfig.value?.commitUrl ?? null, sha),
      };
});
// An agent check: its model by name, and what it spent once over.
const agent = computed(() => {
  const check = props.run.agent;
  if (check === null) {
    return null;
  }
  const model =
    consoleConfig.value?.agents.models.find((known) => known.id === check.model)
      ?.label ?? check.model;
  const usage = check.usage;
  return {
    model,
    spent:
      usage === null
        ? null
        : `≈ ${formatUsd(usage.estimatedUsd)} · ${formatTokens(
            usage.inputTokens + usage.outputTokens
          )} tokens`,
  };
});
// An agent check's report is the agent's transcript.
const REPORT_LABELS: Record<IRunKindChoice, string> = {
  tests: "Open report",
  agent: "Open transcript",
};
const reportLabel = computed(() => REPORT_LABELS[runKindOf(props.run)]);
const look = computed(() => RUN_STATUS_LOOKS[props.run.status]);
const going = computed(() => isActiveStatus(props.run.status));
const parent = computed(() =>
  props.run.parentId === null ? undefined : runWithId(props.run.parentId)
);
const duration = computed(() =>
  props.run.startedAt === null
    ? null
    : formatDuration(elapsed(props.run.startedAt, props.run.endedAt, props.now))
);

async function requestStop(force: boolean): Promise<void> {
  sending.value = true;
  await stop(props.run, force);
  sending.value = false;
}

// Where a check's stored skill came from, in words: this console's, or the skill store's.
const storePlace = computed(
  () => STORE_WORDS[consoleConfig.value?.skillStore.kind ?? "console"].place
);
</script>

<template>
  <header class="flex flex-wrap items-start gap-x-8 gap-y-4">
    <div class="min-w-0 flex-[1_1_20rem] space-y-2">
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
        <StatusPill :look="look" />
        <span
          class="flex items-center gap-0.5 font-mono text-xs text-muted-foreground"
        >
          {{ run.id }}
          <CopyButton :text="run.id" label="Copy the run id" />
        </span>
      </div>
      <h1 class="text-2xl font-semibold tracking-tight text-balance">
        {{ formatLabel(run.selection.label) }}
      </h1>
      <dl class="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
        <div>
          <dt class="sr-only">Environment and profile</dt>
          <dd>
            <span class="font-medium text-foreground">{{ run.env }}</span>
            <template v-if="agent === null"> × {{ run.profile }}</template>
          </dd>
        </div>
        <div v-if="agent !== null" class="flex gap-1.5">
          <dt>Agent check with</dt>
          <dd class="text-foreground">{{ agent.model }}</dd>
        </div>
        <div v-if="run.agent" class="flex gap-1.5">
          <dt>Skill</dt>
          <dd>
            <RouterLink
              :to="
                skillPath(
                  run.agent.skill,
                  run.agent.skillOrigin === 'console' ? 'console' : null,
                  run.ref
                )
              "
              class="rounded-sm text-run underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
              >{{
                run.agent.skillOrigin === "console"
                  ? `${storePlace}'s v${run.agent.skillVersion ?? "?"}`
                  : "from the repo"
              }}</RouterLink
            >
          </dd>
        </div>
        <div v-if="agent?.spent" class="flex gap-1.5">
          <dt>Spent</dt>
          <dd class="tabular-nums">{{ agent.spent }}</dd>
        </div>
        <div class="flex gap-1.5">
          <dt>{{ run.startedAt === null ? "Queued" : "Started" }}</dt>
          <dd class="tabular-nums">
            {{ formatWhen(run.startedAt ?? run.createdAt, now) }}
          </dd>
        </div>
        <div v-if="duration !== null" class="flex gap-1.5">
          <dt>{{ going ? "Running for" : "Took" }}</dt>
          <dd class="tabular-nums">{{ duration }}</dd>
        </div>
        <div v-if="run.parentId !== null" class="flex gap-1.5">
          <dt>Retry of</dt>
          <dd>
            <RouterLink
              :to="runPath(run.parentId)"
              class="rounded-sm text-run underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
              >{{
                parent === undefined
                  ? run.parentId
                  : formatLabel(parent.selection.label)
              }}</RouterLink
            >
          </dd>
        </div>
        <div v-if="run.skipNeeds">
          <dt class="sr-only">Options</dt>
          <dd>Skipped the tiers its tests need</dd>
        </div>
        <div v-if="commit !== null" class="flex gap-1.5">
          <dt>From</dt>
          <dd>
            <span class="text-foreground">{{ run.ref }}</span>
            at
            <a
              v-if="commit.url !== null"
              :href="commit.url"
              target="_blank"
              rel="noopener"
              class="rounded-sm font-mono text-run underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
              >{{ commit.short }}</a
            >
            <span v-else class="font-mono text-foreground">{{
              commit.short
            }}</span>
          </dd>
        </div>
        <div v-if="run.agent?.queuedBy" class="flex gap-1.5">
          <dt>Queued by</dt>
          <dd>
            <RouterLink
              :to="ciPath(run.agent.queuedBy.number)"
              class="rounded-sm text-run underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
              >{{ run.agent.queuedBy.label }} pipeline #{{
                run.agent.queuedBy.number
              }}</RouterLink
            >
          </dd>
        </div>
        <div v-if="run.startedBy !== null" class="flex gap-1.5">
          <dt>By</dt>
          <dd class="text-foreground">{{ run.startedBy }}</dd>
        </div>
        <div v-if="run.stoppedBy !== null" class="flex gap-1.5">
          <dt>Stopped by</dt>
          <dd class="text-foreground">{{ run.stoppedBy }}</dd>
        </div>
      </dl>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <template v-if="actions === 'ci' && run.ci !== null">
        <Button variant="outline" as-child>
          <RouterLink :to="ciPath(run.ci.number)">
            Pipeline #{{ run.ci.number }}
          </RouterLink>
        </Button>
        <Button
          variant="outline"
          as="a"
          :href="run.ci.url"
          target="_blank"
          rel="noopener"
        >
          <ExternalLinkIcon aria-hidden="true" />
          Bitbucket
        </Button>
        <Button
          v-if="hasReport"
          variant="outline"
          as="a"
          :href="reportUrl(run.id, null)"
          target="_blank"
          rel="noopener"
        >
          <ExternalLinkIcon aria-hidden="true" />
          {{ reportLabel }}
        </Button>
      </template>

      <Button
        v-else-if="actions === 'dequeue'"
        variant="outline"
        :disabled="sending || !acting.allowed"
        @click="requestStop(false)"
      >
        <XIcon aria-hidden="true" />
        Remove from queue
      </Button>

      <Button
        v-else-if="actions === 'stop'"
        variant="outline"
        :disabled="sending || !acting.allowed"
        @click="requestStop(false)"
      >
        <SquareIcon class="fill-current" aria-hidden="true" />
        Stop
      </Button>

      <template v-else-if="actions === 'force'">
        <p class="max-w-60 text-sm text-muted-foreground">
          {{
            touchesData
              ? "The tests delete their data before they stop. This can take up to 3 minutes."
              : "Waiting for the browsers to close."
          }}
        </p>
        <AlertDialog v-model:open="forceOpen">
          <AlertDialogTrigger as-child>
            <Button
              variant="outline"
              class="text-fail"
              :disabled="sending || !acting.allowed"
            >
              <OctagonXIcon aria-hidden="true" />
              Force stop
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Force stop this run?</AlertDialogTitle>
              <AlertDialogDescription>
                Its browsers are killed now, so the tests cannot delete the data
                they created. Use Clean up afterwards to remove it.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep waiting</AlertDialogCancel>
              <AlertDialogAction
                class="bg-destructive text-white hover:bg-destructive/90"
                @click="requestStop(true)"
              >
                Force stop
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </template>

      <template v-else>
        <div v-if="failedCount > 0" class="flex">
          <Button
            class="rounded-r-none"
            :disabled="!acting.allowed"
            @click="emit('retry', 'failed')"
          >
            <RotateCcwIcon aria-hidden="true" />
            {{ failedLabel }}
            <span class="tabular-nums opacity-70">{{ failedCount }}</span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button
                class="rounded-l-none border-l border-primary-foreground/20 px-2.5"
                aria-label="More ways to retry"
                :disabled="!acting.allowed"
              >
                <ChevronDownIcon aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem @select="emit('retry', 'all')">
                <RotateCcwIcon aria-hidden="true" />
                Run all again
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <Button
          v-else
          variant="outline"
          :disabled="!acting.allowed"
          @click="emit('retry', 'all')"
        >
          <RotateCcwIcon aria-hidden="true" />
          Run again
        </Button>
        <CleanupDialog
          v-if="cleanable"
          :env="run.env"
          owner="this run"
          :disabled="!acting.allowed"
          :perform="(apply, confirm) => cleanup(run, apply, confirm)"
        />
        <Button
          v-if="hasReport"
          variant="outline"
          as="a"
          :href="reportUrl(run.id, null)"
          target="_blank"
          rel="noopener"
        >
          <ExternalLinkIcon aria-hidden="true" />
          {{ reportLabel }}
        </Button>
      </template>
      <PermissionNote
        v-if="actions !== 'ci'"
        :permission="acting"
        class="w-full"
      />
    </div>
  </header>
</template>
