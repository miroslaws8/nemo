<script setup lang="ts">
import {
  ClapperboardIcon,
  ExternalLinkIcon,
  FileTextIcon,
  ImageIcon,
  PaperclipIcon,
  RotateCcwIcon,
} from "@lucide/vue";
import type { ITestState } from "@shared/types";
import { computed } from "vue";
import { Button } from "@/components/ui/button";
import { hideBroken, showLoaded } from "@/lib/images";
import { isServedRunFile, reportUrl, runFileUrl, traceUrl } from "@/lib/paths";
import type { IAttachmentLink } from "@/types";
import StepList from "./StepList.vue";
import YamlSnippet from "./YamlSnippet.vue";

// One test opened in the list: its errors with the YAML they point at, its steps, the last
// screenshot and what it attached (trace, failure screenshot, error context).

const props = defineProps<{
  runId: string;
  test: ITestState;
  now: number;
  canRetry: boolean;
  hasReport: boolean;
  // Its attachments may be opened (prod's take an operator); the live screenshot always shows.
  filesAllowed: boolean;
}>();

const emit = defineEmits<{ retry: [] }>();

// How each kind of attachment opens; anything else is a plain file link.
const ATTACHMENT_LINKS: Record<
  string,
  (runId: string, path: string, hasReport: boolean) => IAttachmentLink | null
> = {
  // The trace viewer ships inside the HTML report, which exists once the run has ended.
  trace: (runId, path, hasReport) =>
    hasReport
      ? {
          label: "Open trace",
          href: traceUrl(runId, path),
          icon: ClapperboardIcon,
        }
      : null,
  screenshot: (runId, path) => ({
    label: "Failure screenshot",
    href: runFileUrl(runId, path),
    icon: ImageIcon,
  }),
  "error-context": (runId, path) => ({
    label: "Error context",
    href: runFileUrl(runId, path),
    icon: FileTextIcon,
  }),
};

function plainLink(runId: string, name: string, path: string): IAttachmentLink {
  return { label: name, href: runFileUrl(runId, path), icon: PaperclipIcon };
}

const links = computed(() =>
  props.test.attachments.flatMap((attachment) => {
    if (!props.filesAllowed || !isServedRunFile(attachment.path)) {
      return [];
    }
    const describe = ATTACHMENT_LINKS[attachment.name];
    const link =
      describe === undefined
        ? plainLink(props.runId, attachment.name, attachment.path)
        : describe(props.runId, attachment.path, props.hasReport);
    return link === null ? [] : [link];
  })
);

const shotUrl = computed(() =>
  props.test.shot === null
    ? null
    : `${runFileUrl(props.runId, props.test.shot)}?v=${
        props.test.shotVersion ?? 0
      }`
);

// What the engine noted on the test (cleanup, kept data, rate-limit waits); "file" is its YAML
// file, which the console shows elsewhere.
const HIDDEN_NOTES: ReadonlySet<string> = new Set(["file"]);
const NOTE_TONES: ReadonlyMap<string, string> = new Map([
  ["cleanup warning", "text-flaky"],
  ["rate limited", "text-flaky"],
  ["kept for debugging", "text-run"],
]);

const notes = computed(() =>
  props.test.annotations.filter((note) => !HIDDEN_NOTES.has(note.type))
);

// The screenshot and links get a column of their own only when there are any.
const hasAside = computed(
  () => shotUrl.value !== null || links.value.length > 0
);
</script>

<template>
  <div
    class="space-y-5 border-t border-border/60 bg-paper/70 px-2 py-4 sm:pl-[34px]"
  >
    <section
      v-if="test.errors.length > 0"
      class="space-y-3"
      aria-label="Errors"
    >
      <article
        v-for="(error, index) in test.errors"
        :key="index"
        class="overflow-hidden rounded-md border border-fail/30 bg-background"
      >
        <pre
          class="max-h-72 overflow-auto px-3 py-2.5 font-mono text-xs leading-relaxed whitespace-pre-wrap text-fail"
          >{{ error.message }}</pre
        >
        <YamlSnippet
          v-if="error.yaml !== null"
          :run-id="runId"
          :location="error.yaml"
          mark="fail"
          class="border-t"
        />
      </article>
    </section>

    <section v-if="notes.length > 0" aria-label="Notes">
      <h4 class="mb-1.5 text-xs font-medium text-muted-foreground">Notes</h4>
      <ul class="space-y-1 text-sm">
        <li v-for="(note, index) in notes" :key="index" class="flex gap-2">
          <span
            class="shrink-0 font-medium"
            :class="NOTE_TONES.get(note.type) ?? 'text-foreground'"
            >{{ note.type }}</span
          >
          <span
            class="min-w-0 break-words whitespace-pre-line text-muted-foreground"
            >{{ note.description }}</span
          >
        </li>
      </ul>
    </section>

    <div
      class="grid gap-5"
      :class="hasAside ? 'lg:grid-cols-[minmax(0,1fr)_15rem]' : ''"
    >
      <section class="min-w-0" aria-label="Steps">
        <h4 class="mb-1.5 text-xs font-medium text-muted-foreground">Steps</h4>
        <StepList
          v-if="test.steps.length > 0"
          :run-id="runId"
          :steps="test.steps"
          :now="now"
        />
        <p v-else class="text-sm text-muted-foreground">
          {{
            test.status === "queued"
              ? "Has not started yet."
              : "No steps were reported."
          }}
        </p>
      </section>
      <aside v-if="hasAside" class="space-y-3">
        <a
          v-if="shotUrl !== null"
          :href="shotUrl"
          target="_blank"
          rel="noopener"
          class="block overflow-hidden rounded-md border bg-muted outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <img
            :src="shotUrl"
            :alt="`The last screenshot of “${test.title}”`"
            class="aspect-[16/10] w-full object-cover object-top"
            loading="lazy"
            @error="hideBroken"
            @load="showLoaded"
          />
        </a>
        <ul v-if="links.length > 0" class="space-y-1 text-sm">
          <li v-for="link in links" :key="link.href">
            <a
              :href="link.href"
              target="_blank"
              rel="noopener"
              class="inline-flex items-center gap-1.5 rounded-sm text-run underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <component :is="link.icon" class="size-3.5" aria-hidden="true" />
              {{ link.label }}
            </a>
          </li>
        </ul>
      </aside>
    </div>

    <div v-if="canRetry || hasReport" class="flex flex-wrap gap-2">
      <Button
        v-if="canRetry"
        size="sm"
        variant="outline"
        @click="emit('retry')"
      >
        <RotateCcwIcon aria-hidden="true" />
        Retry this test
      </Button>
      <Button
        v-if="hasReport"
        size="sm"
        variant="ghost"
        as="a"
        :href="reportUrl(runId, test.testId)"
        target="_blank"
        rel="noopener"
      >
        <ExternalLinkIcon aria-hidden="true" />
        Open in report
      </Button>
    </div>
  </div>
</template>
