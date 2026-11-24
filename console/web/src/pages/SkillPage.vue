<script setup lang="ts">
import {
  CopyPlusIcon,
  DownloadIcon,
  EllipsisIcon,
  FileUpIcon,
  InfoIcon,
  LockIcon,
  PlayIcon,
  Trash2Icon,
} from "@lucide/vue";
import type { ISkillOrigin } from "@shared/types";
import { useTitle } from "@vueuse/core";
import { computed, ref, watch } from "vue";
import CodeView from "@/components/CodeView.vue";
import DeleteSkill from "@/components/DeleteSkill.vue";
import DisabledReason from "@/components/DisabledReason.vue";
import PageBar from "@/components/PageBar.vue";
import PermissionNote from "@/components/PermissionNote.vue";
import PromoteToProd from "@/components/PromoteToProd.vue";
import RunRow from "@/components/RunRow.vue";
import SkillChip from "@/components/SkillChip.vue";
import SkillOverview from "@/components/SkillOverview.vue";
import SkillProperties from "@/components/SkillProperties.vue";
import StatusGlyph from "@/components/StatusGlyph.vue";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useClock } from "@/composables/useClock";
import { useMenuFocusReturn } from "@/composables/useMenuFocusReturn";
import { useSkillDetail } from "@/composables/useSkills";
import { formatWhen } from "@/lib/format";
import {
  composeSkillPath,
  replaceSkillPath,
  skillPath,
  skillsPath,
  skillYamlUrl,
} from "@/lib/paths";
import { STORE_WORDS } from "@/lib/skills";
import {
  mayEditSkills,
  mayPromoteSkills,
  mayStartRuns,
  refusalOf,
} from "@/state/access";
import { consoleConfig } from "@/state/config";
import { openNewRun } from "@/state/dialogs";
import { runs } from "@/state/runs";
import { modeWords } from "@/state/session";
import type { IPermission, ISkillLinkAction } from "@/types";

// One skill: what it does as its skill.yaml says, what Hermes reads (SKILL.md), the file itself,
// its checks among the console's runs and, for one added in the console, its versions. Like the
// run page: its actions in the title bar ("Run…" opens New run as an agent check of it; below
// `md` the outlined ones fold into a "⋯" menu), its properties in a right column from `lg`.

const props = defineProps<{
  name: string;
  origin: ISkillOrigin | null;
  branch: string | null;
}>();

const LINK =
  "rounded-sm text-run underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50";

const now = useClock();
const tab = ref("overview");
const deleteOpen = ref(false);
const { returnFocus } = useMenuFocusReturn("menuButton");
const { detail, error, reload } = useSkillDetail(
  () => props.name,
  () => props.origin,
  () => props.branch
);
const skill = computed(() => detail.value?.skill ?? null);
const title = computed(() => detail.value?.fields?.title ?? props.name);
useTitle(computed(() => `${title.value} · Skills · QA Console`));
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

// The pages the title bar leads to, each with the role `replacing` asks for: a new skill that
// starts as this one's copy (it has a skill.yaml here), a new version (only of a skill this
// console keeps: hash is null for a repo skill on a server).
const linkActions = computed((): ISkillLinkAction[] => {
  const shown = detail.value;
  if (shown === null) {
    return [];
  }
  const actions: ISkillLinkAction[] = [];
  if (shown.fields !== null) {
    actions.push({
      label: "Use as template",
      icon: CopyPlusIcon,
      to: composeSkillPath({
        from: props.name,
        origin: shown.skill.origin === "console" ? "console" : null,
      }),
    });
  }
  if (shown.hash !== null) {
    actions.push({
      label: "New version…",
      icon: FileUpIcon,
      to: replaceSkillPath(props.name),
    });
  }
  return actions;
});
const yamlUrl = computed(() =>
  detail.value === null || detail.value.yaml === null
    ? null
    : skillYamlUrl(props.name, {
        ref: props.branch,
        origin: detail.value.skill.origin,
      })
);
// Below `md` the outlined actions are in the "⋯" menu: only when there is one.
const hasMenu = computed(
  () =>
    linkActions.value.length > 0 ||
    yamlUrl.value !== null ||
    detail.value?.deletable === true
);
// Why the menu's items are greyed out (a touch screen shows no tooltip).
const menuReason = computed(() =>
  !replacing.value.allowed &&
  (linkActions.value.length > 0 || detail.value?.deletable === true)
    ? replacing.value.reason
    : null
);

// Which of two skills of this name runs, and the link to it.
const SHADOWED: Record<
  ISkillOrigin,
  (place: string) => {
    words: string;
    link: string;
    origin: ISkillOrigin | null;
  }
> = {
  console: () => ({
    words:
      "The repo has a skill of this name on this branch, and that one runs.",
    link: "Open the repo's",
    origin: null,
  }),
  repo: (place) => ({
    words: `${place} has a skill of this name, and that one runs.`,
    link: `Open ${place}'s`,
    origin: "console",
  }),
};
const shadowed = computed(() =>
  skill.value === null || !skill.value.shadowed
    ? null
    : SHADOWED[skill.value.origin](STORE_WORDS[storeKind.value].place)
);

function run(): void {
  openNewRun(null, { skill: props.name, branch: props.branch });
}
</script>

<template>
  <PageBar
    :crumbs="[{ label: 'Skills', to: skillsPath(branch) }]"
    :title="title"
  >
    {{ title }}
    <template v-if="detail !== null && skill !== null" #actions>
      <DisabledReason v-slot="{ describedBy }" :reason="refusalOf(running)">
        <Button
          size="sm"
          :disabled="!running.allowed"
          :aria-describedby="describedBy"
          @click="run()"
        >
          <PlayIcon aria-hidden="true" />
          Run…
        </Button>
      </DisabledReason>

      <!-- From `md` to `lg` they keep only their icon: the tooltip says what they are. -->
      <DisabledReason
        v-for="action in linkActions"
        :key="action.label"
        v-slot="{ describedBy }"
        class="max-md:hidden"
        :reason="refusalOf(replacing)"
        :hint="action.label"
      >
        <Button v-if="replacing.allowed" size="sm" variant="outline" as-child>
          <RouterLink :to="action.to">
            <component :is="action.icon" aria-hidden="true" />
            <span class="max-lg:sr-only">{{ action.label }}</span>
          </RouterLink>
        </Button>
        <Button
          v-else
          size="sm"
          variant="outline"
          disabled
          :aria-describedby="describedBy"
        >
          <component :is="action.icon" aria-hidden="true" />
          <span class="max-lg:sr-only">{{ action.label }}</span>
        </Button>
      </DisabledReason>

      <Tooltip v-if="yamlUrl !== null">
        <TooltipTrigger as-child>
          <Button
            size="icon-sm"
            variant="outline"
            class="max-md:hidden"
            as="a"
            :href="yamlUrl"
            download
          >
            <DownloadIcon aria-hidden="true" />
            <span class="sr-only">Download skill.yaml</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Download skill.yaml</TooltipContent>
      </Tooltip>

      <!-- One dialog: its trigger from `md` up, the "⋯" menu below that. -->
      <DeleteSkill
        v-if="detail.deletable"
        v-model:open="deleteOpen"
        class="max-md:hidden"
        :name="name"
        :store="storeKind"
        :versions="detail.versions.length"
        :promoted="detail.prod !== null"
        :after-deploys="skill.afterDeploys"
        :permission="replacing"
        @close-auto-focus="returnFocus"
      />

      <DropdownMenu v-if="hasMenu">
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
          <DropdownMenuItem
            v-for="action in linkActions"
            :key="action.label"
            :disabled="!replacing.allowed"
            as-child
          >
            <RouterLink :to="action.to">
              <component :is="action.icon" aria-hidden="true" />
              {{ action.label }}
            </RouterLink>
          </DropdownMenuItem>
          <DropdownMenuItem v-if="yamlUrl !== null" as-child>
            <a :href="yamlUrl" download>
              <DownloadIcon aria-hidden="true" />
              Download skill.yaml
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem
            v-if="detail.deletable"
            class="text-fail focus:text-fail"
            :disabled="!replacing.allowed"
            @select="deleteOpen = true"
          >
            <Trash2Icon class="text-fail" aria-hidden="true" />
            Delete…
          </DropdownMenuItem>
          <template v-if="menuReason !== null">
            <DropdownMenuSeparator />
            <DropdownMenuLabel
              class="flex items-start gap-1.5 text-xs font-normal text-muted-foreground"
            >
              <LockIcon class="mt-0.5 size-3 shrink-0" aria-hidden="true" />
              {{ menuReason }}
            </DropdownMenuLabel>
          </template>
        </DropdownMenuContent>
      </DropdownMenu>
    </template>
  </PageBar>

  <div v-if="detail !== null && skill !== null" class="flex min-h-0 flex-1">
    <div class="min-w-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
      <p
        v-if="skill.description !== ''"
        class="max-w-prose text-sm text-muted-foreground"
      >
        {{ skill.description }}
      </p>

      <div
        v-if="
          shadowed !== null ||
          skill.problem !== null ||
          skill.unavailable !== null
        "
        class="space-y-2"
      >
        <p
          v-if="shadowed !== null"
          class="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-md border bg-muted/40 px-3 py-1.5 text-sm"
        >
          <span class="min-w-0">{{ shadowed.words }}</span>
          <RouterLink
            :to="skillPath(name, shadowed.origin, branch)"
            class="shrink-0"
            :class="LINK"
            >{{ shadowed.link }}</RouterLink
          >
        </p>
        <!-- The whole problem, wrapped: no other place on the page says it. -->
        <p
          v-if="skill.problem !== null"
          class="flex items-start gap-2 rounded-md border border-fail/30 bg-fail/5 px-3 py-1.5 text-sm text-fail"
        >
          <StatusGlyph glyph="bang" tone="fail" class="mt-0.5" />
          <span class="min-w-0 [overflow-wrap:anywhere]"
            >Its skill.yaml has a problem here: {{ skill.problem }}</span
          >
        </p>
        <p
          v-else-if="skill.unavailable !== null"
          class="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-1.5 text-sm"
        >
          <StatusGlyph glyph="bang" tone="flaky" class="mt-0.5" />
          <span class="min-w-0"
            >The console does not run it: it {{ skill.unavailable }}.</span
          >
          <Tooltip>
            <TooltipTrigger as-child>
              <button
                type="button"
                class="-my-0.5 ml-auto inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                aria-label="Where it runs"
              >
                <InfoIcon class="size-3.5" aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              Hermes on a Mac can run it (<code class="font-mono"
                >bash hermes/install.sh</code
              >).
            </TooltipContent>
          </Tooltip>
        </p>
      </div>

      <!-- Why New version… and Promote to prod are greyed, for a stored skill. -->
      <PermissionNote
        v-if="skill.origin === 'console'"
        :permission="replacing"
      />

      <!-- Below `lg` the properties have no column of their own: they come before the tabs. -->
      <SkillProperties
        :skill="skill"
        :detail="detail"
        :now="now"
        :store-kind="storeKind"
        :channels="channels"
        class="border-b pb-5 lg:hidden"
      />

      <Tabs v-model="tab">
        <!-- Five tabs are wider than a phone: the bar scrolls sideways there, not the page. -->
        <TabsList class="max-w-full overflow-x-auto overflow-y-hidden">
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
          <SkillOverview
            v-if="detail.fields !== null"
            :fields="detail.fields"
          />
          <p v-else class="text-sm text-muted-foreground">
            This branch has no skill.yaml for it (it is older than the format):
            its SKILL.md is what Hermes reads.
          </p>
        </TabsContent>

        <TabsContent value="skill-md" class="mt-3 space-y-2">
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

        <TabsContent value="yaml" class="mt-3">
          <CodeView
            v-if="detail.yaml !== null"
            :text="detail.yaml"
            :label="`${name}/skill.yaml`"
          />
          <p v-else class="text-sm text-muted-foreground">
            This branch has no skill.yaml for it.
          </p>
        </TabsContent>

        <TabsContent value="checks" class="mt-3">
          <div
            v-if="checks.length > 0"
            class="overflow-hidden rounded-lg border [&>*:last-child]:border-b-0"
          >
            <RunRow
              v-for="check in checks"
              :key="check.id"
              :run="check"
              :now="now"
              :show-person="modeWords.showsPerson"
            />
          </div>
          <p v-else class="text-sm text-muted-foreground">
            No check of it among the console's runs yet.
          </p>
        </TabsContent>

        <TabsContent
          v-if="skill.origin === 'console'"
          value="versions"
          class="mt-3"
        >
          <ol
            class="overflow-hidden rounded-lg border text-sm [&>*:last-child]:border-b-0"
          >
            <li
              v-for="version in versionsNewestFirst"
              :key="version.version"
              class="flex h-[38px] items-center gap-3 border-b border-border/60 px-4"
            >
              <span class="shrink-0 font-mono text-xs font-medium"
                >v{{ version.version }}</span
              >
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
              <span
                class="min-w-0 flex-1 truncate text-muted-foreground tabular-nums"
                :title="
                  version.by === null
                    ? undefined
                    : `${formatWhen(version.at, now)} by ${version.by}`
                "
                >{{ formatWhen(version.at, now)
                }}<template v-if="version.by !== null">
                  · {{ version.by }}</template
                ></span
              >
              <PromoteToProd
                v-if="channels && version.version !== detail.prod?.version"
                class="shrink-0"
                :name="name"
                :version="version.version"
                :prod-version="detail.prod?.version ?? null"
                :permission="promoting"
                @promoted="reload()"
              />
              <a
                :href="skillYamlUrl(name, { version: version.version })"
                download
                class="inline-flex shrink-0 items-center gap-1 text-xs"
                :class="LINK"
              >
                <DownloadIcon class="size-3.5" aria-hidden="true" />
                <span class="max-sm:sr-only">skill.yaml</span>
              </a>
            </li>
          </ol>
        </TabsContent>
      </Tabs>
    </div>

    <aside
      aria-label="Properties"
      class="hidden w-[260px] shrink-0 overflow-y-auto border-l px-5 py-5 lg:block"
    >
      <SkillProperties
        :skill="skill"
        :detail="detail"
        :now="now"
        :store-kind="storeKind"
        :channels="channels"
      />
    </aside>
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
    <Skeleton class="h-4 w-full max-w-prose" />
    <Skeleton class="h-4 w-80" />
    <Skeleton class="h-9 w-72" />
    <Skeleton class="h-48 w-full" />
  </div>
</template>
