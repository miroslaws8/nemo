<script setup lang="ts">
import { CopyPlusIcon, DownloadIcon, FileUpIcon, PlayIcon } from "@lucide/vue";
import type { ISkillOrigin } from "@shared/types";
import { useTitle } from "@vueuse/core";
import { computed, ref, watch } from "vue";
import CodeView from "@/components/CodeView.vue";
import PageBar from "@/components/PageBar.vue";
import RunListItem from "@/components/RunListItem.vue";
import SkillChip from "@/components/SkillChip.vue";
import SkillChips from "@/components/SkillChips.vue";
import SkillOverview from "@/components/SkillOverview.vue";
import StatusIcon from "@/components/StatusIcon.vue";
import DeleteSkill from "@/components/DeleteSkill.vue";
import PermissionNote from "@/components/PermissionNote.vue";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useClock } from "@/composables/useClock";
import { useSkillDetail } from "@/composables/useSkills";
import { formatUsd, formatWhen } from "@/lib/format";
import {
  composeSkillPath,
  replaceSkillPath,
  runPath,
  skillPath,
  skillsPath,
  skillYamlUrl,
} from "@/lib/paths";
import { originWords } from "@/lib/skills";
import PromoteToProd from "@/components/PromoteToProd.vue";
import { RUN_STATUS_LOOKS } from "@/lib/status";
import { mayEditSkills, mayPromoteSkills, mayStartRuns } from "@/state/access";
import { consoleConfig } from "@/state/config";
import { openNewRun } from "@/state/dialogs";
import { runs } from "@/state/runs";
import type { IPermission } from "@/types";

// One skill: what it does as its skill.yaml says, what Hermes reads (SKILL.md), the file itself,
// its checks among the console's runs and, for one added in the console, its versions. "Run…"
// opens New run as an agent check of it.

const props = defineProps<{
  name: string;
  origin: ISkillOrigin | null;
  branch: string | null;
}>();

const now = useClock();
const tab = ref("overview");
const { detail, error, reload } = useSkillDetail(
  () => props.name,
  () => props.origin,
  () => props.branch
);
const skill = computed(() => detail.value?.skill ?? null);
useTitle(
  computed(
    () => `${detail.value?.fields?.title ?? props.name} · Skills · QA Console`
  )
);
watch(
  () => [props.name, props.origin],
  () => {
    tab.value = "overview";
  }
);

const checks = computed(() =>
  runs.value.filter(
    (run) =>
      run.agent?.skill === props.name &&
      run.agent.skillOrigin === (skill.value?.origin ?? "repo")
  )
);
const versionsNewestFirst = computed(() =>
  [...(detail.value?.versions ?? [])].reverse()
);

const running = computed((): IPermission => {
  const agents = consoleConfig.value?.agents;
  if (agents !== undefined && !agents.available) {
    return {
      allowed: false,
      reason: agents.reason ?? "This console runs no agent checks.",
    };
  }
  const shown = skill.value;
  if (shown?.shadowed === true) {
    return {
      allowed: false,
      reason:
        "On this branch the repo's skill of this name runs: open that one to run it.",
    };
  }
  if (shown !== null && shown.unavailable !== null) {
    return {
      allowed: false,
      reason: `The console does not run it: it ${shown.unavailable}.`,
    };
  }
  return mayStartRuns();
});

const replacing = computed(() => mayEditSkills());
const promoting = computed(() => mayPromoteSkills());
const storeKind = computed(
  () => consoleConfig.value?.skillStore.kind ?? "console"
);
// Whether a version is promoted to prod (a store with versions), or the branch decides.
const channels = computed(
  () => consoleConfig.value?.skillStore.channels === true
);

function run(): void {
  openNewRun(null, { skill: props.name, branch: props.branch });
}
</script>

<template>
  <PageBar>
    <span>{{ detail?.fields?.title ?? name }}</span>
  </PageBar>

  <div v-if="detail !== null && skill !== null" class="space-y-6 px-6 py-5">
    <nav aria-label="Breadcrumb" class="text-sm">
      <RouterLink
        :to="skillsPath(branch)"
        class="rounded-sm text-muted-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
        >Skills</RouterLink
      >
    </nav>

    <header class="flex flex-wrap items-start gap-x-8 gap-y-4">
      <div class="min-w-0 flex-[1_1_20rem] space-y-2">
        <p class="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span class="font-mono text-xs text-muted-foreground">{{
            name
          }}</span>
          <SkillChips :skill="skill" />
        </p>
        <h1 class="text-2xl font-semibold tracking-tight text-balance">
          {{ detail.fields?.title ?? name }}
        </h1>
        <p class="max-w-prose text-sm text-muted-foreground">
          {{ skill.description }}
        </p>
        <dl
          class="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground"
        >
          <div class="flex gap-1.5">
            <dt class="sr-only">Source</dt>
            <dd class="text-foreground">
              {{ originWords(skill, storeKind) }}
            </dd>
          </div>
          <div
            v-if="skill.origin === 'console' && channels"
            class="flex gap-1.5"
          >
            <dt>Prod runs</dt>
            <dd>
              <template v-if="detail.prod !== null">
                v{{ detail.prod.version }} ·
                {{ formatWhen(detail.prod.at, now) }}
                <template v-if="detail.prod.by !== null">
                  by {{ detail.prod.by }}</template
                >
              </template>
              <template v-else>no version yet</template>
            </dd>
          </div>
          <div v-if="skill.updatedAt !== null" class="flex gap-1.5">
            <dt>{{ skill.version === 1 ? "Added" : "Replaced" }}</dt>
            <dd>
              {{ formatWhen(skill.updatedAt, now) }}
              <template v-if="skill.updatedBy !== null">
                by
                <span class="text-foreground">{{ skill.updatedBy }}</span>
              </template>
            </dd>
          </div>
          <div v-if="skill.lastRun !== null" class="flex gap-1.5">
            <dt>Last check</dt>
            <dd>
              <RouterLink
                :to="runPath(skill.lastRun.id)"
                class="inline-flex items-center gap-1 rounded-sm text-run underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
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
            </dd>
          </div>
        </dl>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <span :title="running.reason ?? undefined">
          <Button :disabled="!running.allowed" @click="run()">
            <PlayIcon aria-hidden="true" />
            Run…
          </Button>
        </span>
        <!-- A new skill that starts as this one's copy. -->
        <span
          v-if="detail.fields !== null"
          :title="replacing.reason ?? undefined"
        >
          <Button v-if="replacing.allowed" variant="outline" as-child>
            <RouterLink
              :to="
                composeSkillPath({
                  from: name,
                  origin: skill.origin === 'console' ? 'console' : null,
                })
              "
            >
              <CopyPlusIcon aria-hidden="true" />
              Use as template
            </RouterLink>
          </Button>
          <Button v-else variant="outline" disabled>
            <CopyPlusIcon aria-hidden="true" />
            Use as template
          </Button>
        </span>
        <!-- A new version: only of a skill this console keeps (hash: not a repo skill on a server). -->
        <span
          v-if="detail.hash !== null"
          :title="replacing.reason ?? undefined"
        >
          <Button v-if="replacing.allowed" variant="outline" as-child>
            <RouterLink :to="replaceSkillPath(name)">
              <FileUpIcon aria-hidden="true" />
              New version…
            </RouterLink>
          </Button>
          <Button v-else variant="outline" disabled>
            <FileUpIcon aria-hidden="true" />
            New version…
          </Button>
        </span>
        <Button v-if="detail.yaml !== null" variant="outline" as-child>
          <a
            :href="skillYamlUrl(name, { ref: branch, origin: skill.origin })"
            download
          >
            <DownloadIcon aria-hidden="true" />
            skill.yaml
          </a>
        </Button>
        <DeleteSkill
          v-if="detail.deletable"
          :name="name"
          :store="storeKind"
          :versions="detail.versions.length"
          :promoted="detail.prod !== null"
          :after-deploys="skill.afterDeploys"
          :permission="replacing"
        />
      </div>
    </header>

    <!-- Why New version… and Promote to prod are greyed, for a stored skill. -->
    <PermissionNote v-if="skill.origin === 'console'" :permission="replacing" />

    <p
      v-if="skill.shadowed"
      class="rounded-md border bg-muted/40 px-4 py-3 text-sm"
    >
      The repo has a skill of this name on this branch, and that one runs. This
      console's copy stays here:
      <RouterLink
        :to="skillPath(name, null, branch)"
        class="rounded-sm text-run underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
        >open the repo's</RouterLink
      >.
    </p>
    <p
      v-if="skill.problem !== null"
      class="rounded-md border border-fail/30 bg-fail/5 px-4 py-3 text-sm text-fail"
    >
      Its skill.yaml has a problem here: {{ skill.problem }}
    </p>
    <p
      v-else-if="skill.unavailable !== null"
      class="rounded-md border bg-muted/40 px-4 py-3 text-sm"
    >
      The console does not run it: it {{ skill.unavailable }}. Hermes on a Mac
      can (<code class="font-mono text-xs">bash hermes/install.sh</code>).
    </p>

    <Tabs v-model="tab">
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="skill-md">SKILL.md</TabsTrigger>
        <TabsTrigger value="yaml">skill.yaml</TabsTrigger>
        <TabsTrigger value="checks">
          Checks
          <span class="tabular-nums text-muted-foreground">{{
            checks.length
          }}</span>
        </TabsTrigger>
        <TabsTrigger v-if="skill.origin === 'console'" value="versions">
          Versions
          <span class="tabular-nums text-muted-foreground">{{
            detail.versions.length
          }}</span>
        </TabsTrigger>
      </TabsList>

      <TabsContent value="overview" class="mt-5">
        <SkillOverview v-if="detail.fields !== null" :fields="detail.fields" />
        <p v-else class="text-sm text-muted-foreground">
          This branch has no skill.yaml for it (it is older than the format):
          its SKILL.md is what Hermes reads.
        </p>
      </TabsContent>

      <TabsContent value="skill-md" class="mt-5 space-y-2">
        <p class="text-xs text-muted-foreground">
          What Hermes reads: the base every skill shares
          (hermes/skill-template.md) filled in with its skill.yaml.
        </p>
        <CodeView
          v-if="detail.skillMd !== null"
          :text="detail.skillMd"
          label="SKILL.md"
        />
        <p v-else class="text-sm text-muted-foreground">
          Its skill.yaml does not read, so it has no SKILL.md here.
        </p>
      </TabsContent>

      <TabsContent value="yaml" class="mt-5">
        <CodeView
          v-if="detail.yaml !== null"
          :text="detail.yaml"
          :label="`${name}/skill.yaml`"
        />
        <p v-else class="text-sm text-muted-foreground">
          This branch has no skill.yaml for it.
        </p>
      </TabsContent>

      <TabsContent value="checks" class="mt-5">
        <ul
          v-if="checks.length > 0"
          class="divide-y rounded-lg border bg-card px-1 py-1"
        >
          <RunListItem
            v-for="check in checks"
            :key="check.id"
            :run="check"
            :now="now"
          />
        </ul>
        <p v-else class="text-sm text-muted-foreground">
          No check of it among the console's runs yet.
        </p>
      </TabsContent>

      <TabsContent
        v-if="skill.origin === 'console'"
        value="versions"
        class="mt-5"
      >
        <ol class="divide-y rounded-lg border bg-card text-sm">
          <li
            v-for="version in versionsNewestFirst"
            :key="version.version"
            class="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3"
          >
            <span class="font-medium tabular-nums">v{{ version.version }}</span>
            <SkillChip
              v-if="version.version === skill.version"
              tone="run"
              :label="channels ? 'Latest' : 'Current'"
              :title="
                channels
                  ? 'Staging and local run the newest version'
                  : undefined
              "
            />
            <SkillChip
              v-if="channels && version.version === detail.prod?.version"
              tone="pass"
              label="Prod"
              title="Prod runs this version"
            />
            <span class="text-muted-foreground"
              >{{ formatWhen(version.at, now)
              }}<template v-if="version.by !== null">
                by {{ version.by }}</template
              ></span
            >
            <PromoteToProd
              v-if="channels && version.version !== detail.prod?.version"
              class="ml-auto"
              :name="name"
              :version="version.version"
              :prod-version="detail.prod?.version ?? null"
              :permission="promoting"
              @promoted="reload()"
            />
            <a
              :href="skillYamlUrl(name, { version: version.version })"
              download
              class="inline-flex items-center gap-1 rounded-sm text-run underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
              :class="
                channels && version.version !== detail.prod?.version
                  ? ''
                  : 'ml-auto'
              "
            >
              <DownloadIcon class="size-3.5" aria-hidden="true" />
              skill.yaml
            </a>
          </li>
        </ol>
      </TabsContent>
    </Tabs>
  </div>

  <div
    v-else-if="error !== null"
    class="space-y-3 px-6 py-5 text-center text-sm text-muted-foreground"
  >
    <p class="text-base font-medium text-foreground">{{ error }}</p>
    <p>
      <RouterLink
        :to="skillsPath(branch)"
        class="text-run underline-offset-2 hover:underline"
        >See every skill</RouterLink
      >
      or
      <button
        type="button"
        class="text-run underline-offset-2 hover:underline"
        @click="reload()"
      >
        try again</button
      >.
    </p>
  </div>

  <div v-else class="space-y-4 px-6 py-5" aria-label="Reading the skill">
    <Skeleton class="h-4 w-40" />
    <Skeleton class="h-8 w-80" />
    <Skeleton class="h-4 w-full max-w-prose" />
    <Skeleton class="h-48 w-full" />
  </div>
</template>
