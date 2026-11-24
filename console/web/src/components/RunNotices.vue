<script setup lang="ts">
import { ChevronRightIcon, GaugeIcon, KeyRoundIcon } from "@lucide/vue";
import type { INoticeKind, IRunState } from "@shared/types";
import { computed } from "vue";
import { formatClock, plural } from "@/lib/format";
import { TONE_CLASSES } from "@/lib/status";
import type { INoticeBanner } from "@/types";

// Banners for what slows a run down or breaks it from outside the tests: the API's rate limit
// (429) and the QA account's session ending. The tests report them as they happen
// (engine/notices.ts). Each is one line (its title and what it means for the run); its details
// open below it: how it happened, what to do, and the last message the API gave.

const props = defineProps<{ state: IRunState; going: boolean }>();

const BANNERS: Record<INoticeKind, INoticeBanner> = {
  "session-lost": {
    title: "The QA account's session has ended",
    icon: KeyRoundIcon,
    tone: "fail",
    line: (_notice, going) =>
      going
        ? "the tests from here on fail: stop the run and start a new one, which logs in again."
        : "tests after that point failed for this reason; a new run logs in again.",
    details: (notice) => [
      `At ${formatClock(
        notice.lastAt
      )} the API stopped accepting the run's session. That happens when someone logs out of the QA account: logging out ends every session of the account, this run's too.`,
      "Keep the QA account logged in while tests run.",
    ],
  },
  "rate-limit": {
    title: "The API is rate-limiting the QA account",
    icon: GaugeIcon,
    tone: "flaky",
    line: (notice, going) =>
      `${plural(
        notice.count,
        "wait",
        "waits"
      )} on a 429, the last at ${formatClock(notice.lastAt)}: ${
        going
          ? "the run waits each one out and goes on, only slower."
          : "the run waited each one out, so it took longer."
      }`,
    details: () => [
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
  <div v-if="banners.length > 0" role="status" class="space-y-2">
    <details
      v-for="entry in banners"
      :key="entry.kind"
      :class="[
        'group rounded-md text-sm',
        TONE_CLASSES[entry.banner.tone].soft,
      ]"
    >
      <summary
        class="flex cursor-pointer list-none items-start gap-2 rounded-md px-3 py-2 outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden"
      >
        <component
          :is="entry.banner.icon"
          :class="[
            'mt-0.5 size-4 shrink-0',
            TONE_CLASSES[entry.banner.tone].text,
          ]"
          aria-hidden="true"
        />
        <span class="min-w-0 flex-1">
          <span
            :class="['font-medium', TONE_CLASSES[entry.banner.tone].text]"
            >{{ entry.banner.title }}</span
          >
          <span class="text-foreground/80">
            — {{ entry.banner.line(entry.notice, going) }}</span
          >
        </span>
        <span
          class="mt-px flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground"
        >
          <span class="max-sm:sr-only">Details</span>
          <ChevronRightIcon
            class="size-3.5 transition-transform group-open:rotate-90"
            aria-hidden="true"
          />
        </span>
      </summary>
      <div class="space-y-1.5 px-3 pb-2.5 pl-9 text-foreground/80">
        <p
          v-for="detail in entry.banner.details(entry.notice, going)"
          :key="detail"
        >
          {{ detail }}
        </p>
        <p class="font-mono text-xs break-words text-muted-foreground">
          {{ entry.notice.lastMessage }}
        </p>
      </div>
    </details>
  </div>
</template>
