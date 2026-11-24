<script setup lang="ts">
import { GitBranchIcon, PlusIcon } from "@lucide/vue";
import { useTitle } from "@vueuse/core";
import type { ISkillList, ISkillOrigin } from "@shared/types";
import { computed } from "vue";
import { useRouter } from "vue-router";
import PageBar from "@/components/PageBar.vue";
import PermissionNote from "@/components/PermissionNote.vue";
import SkillRow from "@/components/SkillRow.vue";
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
import { newSkillPath, skillsPath } from "@/lib/paths";
import { sourceWords, STORE_WORDS } from "@/lib/skills";
import { TONE_CLASSES } from "@/lib/status";
import { mayEditSkills, mayStartRuns } from "@/state/access";
import { consoleConfig, environmentNamed } from "@/state/config";

// Every skill an agent check may follow: the repo's (hermes/skills of a branch: the default
// environment's unless the page asks for another) and, on a server console, the ones added in it;
// each with what it changes, where CI runs it and how its last check went. The store's skills come
// first, then the repo's, each under a heading; a group with none is left out.

const props = defineProps<{ branch: string | null }>();

useTitle("Skills · QA Console");
const router = useRouter();
const now = useClock();

const { list, loading, error, reload } = useSkillList(() => props.branch);
// The ones the console runs first; those it cannot run (scripts, a fixture) after them.
const skills = computed(() =>
  [...(list.value?.skills ?? [])].sort(
    (left, right) =>
      Number(left.unavailable !== null) - Number(right.unavailable !== null)
  )
);

// The groups in their order, and how each is headed: the store by its kind, the repo by its commit.
const GROUPS: {
  origin: ISkillOrigin;
  heading: (skillList: ISkillList) => { title: string; detail: string | null };
}[] = [
  {
    origin: "console",
    heading: (skillList) => ({
      title: STORE_WORDS[skillList.store].heading,
      detail: null,
    }),
  },
  {
    origin: "repo",
    heading: (skillList) => ({
      title: "Repo",
      detail: sourceWords(skillList.source),
    }),
  },
];
const SKELETON_ROWS = 6;

const groups = computed(() => {
  const skillList = list.value;
  if (skillList === null) {
    return [];
  }
  return GROUPS.map((group) => ({
    origin: group.origin,
    ...group.heading(skillList),
    skills: skills.value.filter((skill) => skill.origin === group.origin),
  })).filter((group) => group.skills.length > 0);
});

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
  <PageBar>
    <span>Skills</span>
    <template #actions>
      <Select
        v-if="mayPickBranch"
        :model-value="shownBranch"
        @update:model-value="pickBranch"
      >
        <SelectTrigger
          size="sm"
          class="w-44 max-sm:w-32"
          aria-label="Branch of the repo's skills"
        >
          <GitBranchIcon aria-hidden="true" />
          <SelectValue placeholder="A branch" class="min-w-0 flex-1" />
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
      <span :title="adding.reason ?? undefined">
        <Button v-if="adding.allowed" size="sm" as-child>
          <RouterLink :to="newSkillPath()">
            <PlusIcon aria-hidden="true" />
            New skill
          </RouterLink>
        </Button>
        <Button v-else size="sm" disabled>
          <PlusIcon aria-hidden="true" />
          New skill
        </Button>
      </span>
    </template>
  </PageBar>

  <!-- Why New skill is greyed: the role, or a console that only reads the skill store. -->
  <PermissionNote :permission="adding" class="border-b px-4 py-2" />

  <div
    v-if="error !== null"
    class="flex min-h-[38px] flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/60 px-4 py-1.5 text-sm"
    :class="TONE_CLASSES.fail.soft"
    role="alert"
  >
    <p class="min-w-0 flex-1" :class="TONE_CLASSES.fail.text">{{ error }}</p>
    <Button size="sm" variant="outline" @click="reload()">Try again</Button>
  </div>

  <div v-else-if="list === null" aria-label="Reading the skills">
    <div
      v-for="index in SKELETON_ROWS"
      :key="index"
      class="flex h-[38px] items-center gap-3 border-b border-border/60 px-4"
      aria-hidden="true"
    >
      <Skeleton class="size-1.5 rounded-full" />
      <Skeleton class="h-3 w-1/4" />
      <Skeleton class="h-3 w-2/5 max-md:hidden" />
      <Skeleton class="ml-auto h-3 w-20" />
    </div>
  </div>

  <p
    v-else-if="groups.length === 0"
    class="py-16 text-center text-sm text-faint"
  >
    No skills here.
    <span class="block text-xs"
      >Nothing in the hermes/skills of {{ sourceWords(list.source) }}.</span
    >
  </p>

  <div v-else :aria-busy="loading">
    <section v-for="group in groups" :key="group.origin">
      <h2
        class="sticky top-11 z-2 flex h-8 items-center gap-2 border-b bg-paper px-4 text-sm font-medium"
      >
        <span class="truncate">
          {{ group.title }}
          <span v-if="group.detail !== null" class="font-normal text-faint"
            >· {{ group.detail }}</span
          >
        </span>
        <span class="font-normal text-faint tabular-nums">{{
          group.skills.length
        }}</span>
      </h2>
      <SkillRow
        v-for="skill in group.skills"
        :key="`${skill.name}:${skill.origin}`"
        :skill="skill"
        :branch="branch"
        :now="now"
      />
    </section>
  </div>
</template>
