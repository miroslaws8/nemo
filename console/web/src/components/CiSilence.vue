<script setup lang="ts">
import { UnplugIcon } from "@lucide/vue";
import type { IRunRecord, IRunState } from "@shared/types";
import { computed } from "vue";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { formatClock } from "@/lib/format";

// A CI run the console follows that has sent nothing for 15 minutes: the step lost the console
// (or hangs). The console ends the run once its pipeline ends; until then Bitbucket knows more.

const QUIET_MS = 15 * 60_000;

const props = defineProps<{
  run: IRunRecord;
  state: IRunState;
  going: boolean;
  now: number;
}>();

const lastHeard = computed(
  () => props.state.lastEventAt ?? props.run.startedAt ?? props.run.createdAt
);
const quietMinutes = computed(() =>
  Math.floor((props.now - Date.parse(lastHeard.value)) / 60_000)
);
const quiet = computed(
  () =>
    props.run.ci !== null &&
    props.going &&
    props.now - Date.parse(lastHeard.value) >= QUIET_MS
);
</script>

<template>
  <Alert
    v-if="quiet && run.ci !== null"
    class="border-flaky/40 bg-flaky/5 [&>svg]:text-flaky"
  >
    <UnplugIcon aria-hidden="true" />
    <AlertTitle>No word from CI for {{ quietMinutes }} minutes</AlertTitle>
    <AlertDescription class="max-w-3xl space-y-1.5">
      <p class="text-foreground/80">
        The last event came at {{ formatClock(lastHeard) }}. The pipeline may
        still be going without reaching the console, or its step hangs:
        <a
          :href="run.ci.url"
          target="_blank"
          rel="noopener"
          class="underline underline-offset-4"
          >pipeline #{{ run.ci.number }} in Bitbucket</a
        >
        shows which.
      </p>
      <p class="text-foreground/80">
        The console ends this run 2 minutes after its pipeline ends.
      </p>
    </AlertDescription>
  </Alert>
</template>
