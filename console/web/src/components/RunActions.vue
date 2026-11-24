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
import { ciPath, reportUrl } from "@/lib/paths";
import { originOf, runKindOf } from "@/lib/run-facts";
import { mayActOn } from "@/state/access";
import type { IRunActionSet, IRunKindChoice, IRunOrigin } from "@/types";
import CleanupDialog from "./CleanupDialog.vue";

// A run's buttons in its title bar: stop it, run it again, clean up after it, open its report.
// The first of each set is filled, the rest outlined; below `sm` the outlined ones keep only
// their icon (their word stays for screen readers), so the crumbs keep some room. Why a button
// is greyed out, and what a stopping run waits for, the page says under the bar.

const props = defineProps<{
  run: IRunRecord;
  failedCount: number;
  // "Retry failed", or "Run the rest" when nothing failed but tests were stopped or never ran.
  failedLabel: string;
  hasReport: boolean;
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
// An agent check's report is the agent's transcript.
const REPORT_LABELS: Record<IRunKindChoice, string> = {
  tests: "Open report",
  agent: "Open transcript",
  author: "Open report",
};
const reportLabel = computed(() => REPORT_LABELS[runKindOf(props.run)]);

async function requestStop(force: boolean): Promise<void> {
  sending.value = true;
  await stop(props.run, force);
  sending.value = false;
}
</script>

<template>
  <template v-if="actions === 'ci' && run.ci !== null">
    <Button size="sm" as-child>
      <RouterLink :to="ciPath(run.ci.number)">
        Pipeline #{{ run.ci.number }}
      </RouterLink>
    </Button>
    <Button
      size="sm"
      variant="outline"
      as="a"
      :href="run.ci.url"
      target="_blank"
      rel="noopener"
    >
      <ExternalLinkIcon aria-hidden="true" />
      <span class="max-sm:sr-only">Bitbucket</span>
    </Button>
    <Button
      v-if="hasReport"
      size="sm"
      variant="outline"
      as="a"
      :href="reportUrl(run.id, null)"
      target="_blank"
      rel="noopener"
    >
      <ExternalLinkIcon aria-hidden="true" />
      <span class="max-sm:sr-only">{{ reportLabel }}</span>
    </Button>
  </template>

  <Button
    v-else-if="actions === 'dequeue'"
    size="sm"
    :disabled="sending || !acting.allowed"
    @click="requestStop(false)"
  >
    <XIcon aria-hidden="true" />
    Remove from queue
  </Button>

  <Button
    v-else-if="actions === 'stop'"
    size="sm"
    :disabled="sending || !acting.allowed"
    @click="requestStop(false)"
  >
    <SquareIcon class="fill-current" aria-hidden="true" />
    Stop
  </Button>

  <AlertDialog v-else-if="actions === 'force'" v-model:open="forceOpen">
    <AlertDialogTrigger as-child>
      <Button size="sm" :disabled="sending || !acting.allowed">
        <OctagonXIcon aria-hidden="true" />
        Force stop
      </Button>
    </AlertDialogTrigger>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Force stop this run?</AlertDialogTitle>
        <AlertDialogDescription>
          Its browsers are killed now, so the tests cannot delete the data they
          created. Use Clean up afterwards to remove it.
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

  <template v-else>
    <div v-if="failedCount > 0" class="flex">
      <Button
        size="sm"
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
            size="sm"
            class="rounded-l-none border-l border-primary-foreground/20 px-2"
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
      size="sm"
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
      compact
      :disabled="!acting.allowed"
      :perform="(apply, confirm) => cleanup(run, apply, confirm)"
    />
    <Button
      v-if="hasReport"
      size="sm"
      variant="outline"
      as="a"
      :href="reportUrl(run.id, null)"
      target="_blank"
      rel="noopener"
    >
      <ExternalLinkIcon aria-hidden="true" />
      <span class="max-sm:sr-only">{{ reportLabel }}</span>
    </Button>
  </template>
</template>
