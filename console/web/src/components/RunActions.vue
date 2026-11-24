<script setup lang="ts">
import {
  ChevronDownIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  LockIcon,
  OctagonXIcon,
  RotateCcwIcon,
  SquareIcon,
  Trash2Icon,
  XIcon,
} from "@lucide/vue";
import type { IRunRecord, IRunStatus } from "@shared/types";
import { unrefElement } from "@vueuse/core";
import { computed, ref, useTemplateRef, watch } from "vue";
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useRunActions } from "@/composables/useRunActions";
import { ciPath, reportUrl } from "@/lib/paths";
import { originOf, runKindOf } from "@/lib/run-facts";
import { mayActOn } from "@/state/access";
import type { IRunActionSet, IRunKindChoice, IRunOrigin } from "@/types";
import CleanupDialog from "./CleanupDialog.vue";

// A run's buttons in its title bar: stop it, run it again, clean up after it, open its report.
// The first of each set is filled, the rest outlined; below `md` the outlined ones fold into a
// "⋯" menu (a dialog it opens gives the focus back to it), so the bar fits a phone. Why a button
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
const cleanupOpen = ref(false);
const menuButton = useTemplateRef("menuButton");

// Another run (the page stays, its run changes): no dialog of the last one stays open.
watch(
  () => props.run.id,
  () => {
    forceOpen.value = false;
    cleanupOpen.value = false;
  }
);

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
// The "⋯" menu shows only when an outlined button folds into it.
const folds = computed(
  () =>
    (actions.value === "ci" && props.run.ci !== null) ||
    (actions.value === "finished" && (props.cleanable || props.hasReport))
);

/** A dialog the "⋯" menu opened gives the focus back to the menu: its own trigger is hidden. */
function returnFocus(event: Event): void {
  const button = unrefElement(menuButton);
  if (button instanceof HTMLElement && button.getClientRects().length > 0) {
    event.preventDefault();
    button.focus();
  }
}

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
      class="max-md:hidden"
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
      size="sm"
      variant="outline"
      class="max-md:hidden"
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
      v-model:open="cleanupOpen"
      class="max-md:hidden"
      :env="run.env"
      owner="this run"
      compact
      :disabled="!acting.allowed"
      :perform="(apply, confirm) => cleanup(run, apply, confirm)"
      @close-auto-focus="returnFocus"
    />
    <Button
      v-if="hasReport"
      size="sm"
      variant="outline"
      class="max-md:hidden"
      as="a"
      :href="reportUrl(run.id, null)"
      target="_blank"
      rel="noopener"
    >
      <ExternalLinkIcon aria-hidden="true" />
      {{ reportLabel }}
    </Button>
  </template>

  <DropdownMenu v-if="folds">
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
      <template v-if="actions === 'ci' && run.ci !== null">
        <DropdownMenuItem as-child>
          <a :href="run.ci.url" target="_blank" rel="noopener">
            <ExternalLinkIcon aria-hidden="true" />
            Open in Bitbucket
          </a>
        </DropdownMenuItem>
      </template>
      <DropdownMenuItem
        v-else-if="cleanable"
        :disabled="!acting.allowed"
        @select="cleanupOpen = true"
      >
        <Trash2Icon aria-hidden="true" />
        Clean up…
      </DropdownMenuItem>
      <DropdownMenuItem v-if="hasReport" as-child>
        <a :href="reportUrl(run.id, null)" target="_blank" rel="noopener">
          <ExternalLinkIcon aria-hidden="true" />
          {{ reportLabel }}
        </a>
      </DropdownMenuItem>
      <template
        v-if="
          actions === 'finished' &&
          cleanable &&
          !acting.allowed &&
          acting.reason !== null
        "
      >
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
