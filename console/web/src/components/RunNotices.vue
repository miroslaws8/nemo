<script setup lang="ts">
import { GaugeIcon, KeyRoundIcon } from "@lucide/vue";
import type { INoticeKind, IRunState } from "@shared/types";
import { computed } from "vue";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { formatClock, plural } from "@/lib/format";
import type { INoticeBanner } from "@/types";

// Banners for what slows a run down or breaks it from outside the tests: the API's rate limit
// (429) and the QA account's session ending. The tests report them as they happen
// (engine/notices.ts).

const props = defineProps<{ state: IRunState; going: boolean }>();

const BANNERS: Record<INoticeKind, INoticeBanner> = {
  "session-lost": {
    title: "The QA account's session has ended",
    icon: KeyRoundIcon,
    variant: "destructive",
    classes: "border-fail/40 bg-fail/5",
    lines: (notice, going) => [
      `At ${formatClock(
        notice.lastAt
      )} the API stopped accepting the run's session. That happens when someone logs out of the QA account: logging out ends every session of the account, this run's too.`,
      going
        ? "The tests from here on fail. Stop the run and start a new one: it logs in again."
        : "Tests after that point failed for this reason. A new run logs in again.",
      "Keep the QA account logged in while tests run.",
    ],
  },
  "rate-limit": {
    title: "The API is rate-limiting the QA account",
    icon: GaugeIcon,
    variant: "default",
    classes: "border-flaky/40 bg-flaky/5 [&>svg]:text-flaky",
    lines: (notice, going) => [
      `${plural(
        notice.count,
        "wait",
        "waits"
      )} on a 429 so far, the last at ${formatClock(notice.lastAt)}. ${
        going
          ? "The run waits each one out and goes on: it is only slower."
          : "The run waited each one out, so it took longer."
      }`,
      "Everything that uses the QA account shares its limit: other runs, CI and people logged in as it.",
    ],
  },
};

// The more serious first.
const ORDER: INoticeKind[] = ["session-lost", "rate-limit"];

const banners = computed(() =>
  ORDER.flatMap((kind) => {
    const notice = props.state.notices[kind];
    return notice === null ? [] : [{ kind, notice, banner: BANNERS[kind] }];
  })
);
</script>

<template>
  <div v-if="banners.length > 0" class="space-y-3">
    <Alert
      v-for="entry in banners"
      :key="entry.kind"
      :variant="entry.banner.variant"
      :class="entry.banner.classes"
    >
      <component :is="entry.banner.icon" aria-hidden="true" />
      <AlertTitle>{{ entry.banner.title }}</AlertTitle>
      <AlertDescription class="max-w-3xl space-y-1.5">
        <p
          v-for="line in entry.banner.lines(entry.notice, going)"
          :key="line"
          class="text-foreground/80"
        >
          {{ line }}
        </p>
        <p class="font-mono text-xs break-words text-muted-foreground">
          {{ entry.notice.lastMessage }}
        </p>
      </AlertDescription>
    </Alert>
  </div>
</template>
