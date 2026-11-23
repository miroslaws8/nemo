<script setup lang="ts">
import { GitBranchIcon, PlusIcon } from "@lucide/vue";
import { useTitle } from "@vueuse/core";
import { computed, useId } from "vue";
import { useRouter } from "vue-router";
import SkillChips from "@/components/SkillChips.vue";
import StatusIcon from "@/components/StatusIcon.vue";
import PermissionNote from "@/components/PermissionNote.vue";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useBranches } from "@/composables/useBranches";
import { useClock } from "@/composables/useClock";
import { useSkillList } from "@/composables/useSkills";
import { formatUsd, formatWhen } from "@/lib/format";
import { newSkillPath, runPath, skillPath, skillsPath } from "@/lib/paths";
import { linkOrigin, sourceWords } from "@/lib/skills";
import { RUN_STATUS_LOOKS } from "@/lib/status";
import { mayEditSkills, mayStartRuns } from "@/state/access";
import { consoleConfig, environmentNamed, storeWords } from "@/state/config";

// Every skill an agent check may follow: the repo's (hermes/skills of a branch: the default
// environment's unless the page asks for another) and, on a server console, the ones added in it;
// each with what it changes, where CI runs it and how its last check went.

const props = defineProps<{ branch: string | null }>();

useTitle("Skills · QA Console");
const router = useRouter();
const now = useClock();
const branchId = useId();

const { list, loading, error, reload } = useSkillList(() => props.branch);
// The ones the console runs first; those it cannot run (scripts, a fixture) after them.
const skills = computed(() =>
  [...(list.value?.skills ?? [])].sort(
    (left, right) =>
      Number(left.unavailable !== null) - Number(right.unavailable !== null)
  )
);

const fromGit = computed(() => consoleConfig.value?.testsFrom === "git");
// Branches are listed to runners and up (GET /api/branches).
const mayPickBranch = computed(() => fromGit.value && mayStartRuns().allowed);
const { branches } = useBranches(mayPickBranch);
const defaultBranch = computed(
  () =>
    environmentNamed(consoleConfig.value?.defaultEnvironment ?? "")?.branch ??
    ""
);
const shownBranch = computed(() => props.branch ?? defaultBranch.value);
const adding = computed(() => mayEditSkills());

function pickBranch(value: unknown): void {
  if (typeof value === "string") {
    void router.replace(
      skillsPath(value === defaultBranch.value ? null : value)
    );
  }
}
</script>

<template>
  <div class="mx-auto w-full max-w-4xl px-6 py-10">
    <div class="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div class="min-w-0">
        <h1 class="text-2xl font-semibold tracking-tight">Skills</h1>
        <p class="mt-1 max-w-prose text-sm text-muted-foreground">
          What an agent check follows: Hermes reads each skill's SKILL.md,
          written from its skill.yaml. {{ storeWords.skills }}
        </p>
      </div>
      <div class="flex flex-wrap items-end gap-3">
        <div v-if="mayPickBranch" class="grid gap-1.5">
          <label
            :for="branchId"
            class="flex items-center gap-1.5 text-xs text-muted-foreground"
          >
            <GitBranchIcon class="size-3.5" aria-hidden="true" />
            The repo's skills of
          </label>
          <Select :model-value="shownBranch" @update:model-value="pickBranch">
            <SelectTrigger :id="branchId" class="w-56">
              <SelectValue placeholder="A branch" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="candidate in branches"
                :key="candidate.name"
                :value="candidate.name"
              >
                {{ candidate.name }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <span :title="adding.reason ?? undefined">
          <Button v-if="adding.allowed" as-child>
            <RouterLink :to="newSkillPath()">
              <PlusIcon aria-hidden="true" />
              Add skill
            </RouterLink>
          </Button>
          <Button v-else disabled>
            <PlusIcon aria-hidden="true" />
            Add skill
          </Button>
        </span>
      </div>
    </div>

    <!-- Why Add skill is greyed: the role, or a console that only reads the skill store. -->
    <PermissionNote :permission="adding" class="mt-4" />

    <p
      v-if="list !== null && list.source.sha !== null"
      class="mt-4 text-xs text-muted-foreground"
    >
      The repo's skills of {{ sourceWords(list.source) }}.
    </p>

    <div
      v-if="error !== null"
      class="mt-6 flex flex-wrap items-center gap-3 rounded-md border border-fail/30 bg-fail/5 px-4 py-3 text-sm"
    >
      <p class="text-fail">{{ error }}</p>
      <Button size="sm" variant="outline" @click="reload()">Try again</Button>
    </div>

    <ul
      v-else-if="list !== null && list.skills.length > 0"
      class="mt-3 divide-y overflow-hidden rounded-lg border bg-card"
      :aria-busy="loading"
    >
      <li
        v-for="skill in skills"
        :key="`${skill.name}:${skill.origin}`"
        class="relative flex flex-wrap items-start gap-x-6 gap-y-2 px-5 py-4 transition-colors focus-within:bg-accent/40 hover:bg-accent/40"
      >
        <div class="min-w-0 flex-[1_1_20rem]">
          <RouterLink
            :to="skillPath(skill.name, linkOrigin(skill), branch)"
            class="rounded-sm font-medium outline-none after:absolute after:inset-0 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring/50"
            >{{ skill.title ?? skill.name }}</RouterLink
          >
          <p class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span class="font-mono text-xs text-muted-foreground">{{
              skill.name
            }}</span>
            <SkillChips :skill="skill" />
          </p>
          <p
            class="mt-1.5 line-clamp-2 max-w-prose text-sm text-muted-foreground"
          >
            {{ skill.description }}
          </p>
        </div>
        <RouterLink
          v-if="skill.lastRun !== null"
          :to="runPath(skill.lastRun.id)"
          class="relative z-10 flex shrink-0 items-center gap-1.5 rounded-sm text-xs text-muted-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <StatusIcon
            :look="RUN_STATUS_LOOKS[skill.lastRun.status]"
            class="size-3.5"
            aria-hidden="true"
          />
          {{ RUN_STATUS_LOOKS[skill.lastRun.status].label }}
          <template v-if="skill.lastRun.endedAt !== null">
            {{ formatWhen(skill.lastRun.endedAt, now) }}</template
          >
          <template v-if="skill.lastRun.usd !== null">
            · {{ formatUsd(skill.lastRun.usd) }}</template
          >
        </RouterLink>
        <p v-else class="shrink-0 text-xs text-muted-foreground">
          No check yet
        </p>
      </li>
    </ul>

    <p
      v-else-if="list !== null"
      class="mt-6 rounded-lg border bg-card px-5 py-8 text-center text-sm text-muted-foreground"
    >
      No skills here: {{ sourceWords(list.source) }} has no hermes/skills.
    </p>

    <div v-else class="mt-6 space-y-3" aria-label="Reading the skills">
      <Skeleton class="h-20 w-full" />
      <Skeleton class="h-20 w-full" />
      <Skeleton class="h-20 w-full" />
    </div>
  </div>
</template>
