<script setup lang="ts">
import {
  BotIcon,
  ListChecksIcon,
  PencilLineIcon,
  PlayIcon,
  XIcon,
} from "@lucide/vue";
import type {
  ICatalogTest,
  IStartAgentRunRequest,
  IStartRunRequest,
} from "@shared/types";
import { type Component, computed, nextTick, ref, useId, watch } from "vue";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAgentSkills } from "@/composables/useAgentSkills";
import { useBranches } from "@/composables/useBranches";
import { useCatalog } from "@/composables/useCatalog";
import { useRunActions } from "@/composables/useRunActions";
import { plural, tierOf } from "@/lib/format";
import { mayActOn, mayRunAlongsideCi } from "@/state/access";
import { consoleConfig, environmentNamed, tierNamed } from "@/state/config";
import { newRunEnvironment, newRunOpen, newRunPreset } from "@/state/dialogs";
import { ciTitle } from "@/lib/ci";
import { activeCiOn } from "@/state/ci";
import { activeRunOn, activeRunsOn } from "@/state/runs";
import { modeWords } from "@/state/session";
import type {
  INewRunPill,
  IRunKindChoice,
  ISelectionMode,
  ITagCount,
} from "@/types";
import NewRunAgent from "./NewRunAgent.vue";
import NewRunAuthor from "./NewRunAuthor.vue";
import NewRunProperties from "./NewRunProperties.vue";
import NewRunTests from "./NewRunTests.vue";
import PermissionNote from "./PermissionNote.vue";

// Starts a run: an environment, a profile, and all of its tests, some picked by hand or the
// ones with given tags — or an agent check: Hermes Agent runs one of the skills with a model. A
// server console runs a branch (the environment's own by default). A guarded environment (prod)
// asks for its name. A run waits while CI runs hold its environment; an operator may start it
// alongside them.

// What a run can be, each with its icon (the dialog opens on the agent check where the console
// has agents).
const KINDS: {
  value: IRunKindChoice;
  label: string;
  icon: Component;
}[] = [
  { value: "tests", label: "Tests", icon: ListChecksIcon },
  { value: "agent", label: "Agent check", icon: BotIcon },
  { value: "author", label: "Write a test", icon: PencilLineIcon },
];

// The properties each kind of run takes, shown as pills under its body (where they apply: a
// branch on a server console, skipping needed tiers when the tests need some, starting alongside
// CI while CI holds the environment).
const PILLS: Record<IRunKindChoice, ReadonlySet<INewRunPill>> = {
  tests: new Set<INewRunPill>([
    "profile",
    "branch",
    "skipNeeds",
    "alongsideCi",
  ]),
  agent: new Set<INewRunPill>(["model", "branch", "alongsideCi"]),
  author: new Set<INewRunPill>(),
};

const START_WORDS: Record<IRunKindChoice, string> = {
  tests: "Start run",
  agent: "Start check",
  author: "Write the test",
};

// What a description of a test may be (startAuthorRunRequestSchema).
const GOAL_MIN = 5;
const GOAL_MAX = 500;

const { start, startAgent, startAuthor } = useRunActions();

const kind = ref<IRunKindChoice>("agent");
const skill = ref("");
const model = ref("");
// One line for the skill after the environment (e.g. an asset type).
const skillArguments = ref("");
// What to check, in a person's words (a test written with AI).
const goal = ref("");
const environment = ref("");
const profile = ref("");
const mode = ref<ISelectionMode>("all");
const picked = ref<string[]>([]);
const tags = ref<string[]>([]);
const skipNeeds = ref(false);
const alongsideCi = ref(false);
const typed = ref("");
// The branch to test (a server console); "" until the environment gives its own.
const branch = ref("");
const submitting = ref(false);
const ids = { confirm: useId(), guardedWords: useId() };

const environments = computed(() => consoleConfig.value?.environments ?? []);
// The environments this person may run on; the others are greyed out.
const permitted = computed(
  () =>
    new Set(
      environments.value
        .filter((entry) => mayActOn(entry.name).allowed)
        .map((entry) => entry.name)
    )
);
// Why some are greyed out (the first refusal says which role it takes).
const refusal = computed(
  () =>
    environments.value
      .map((entry) => mayActOn(entry.name))
      .find((permission) => !permission.allowed) ?? null
);
const profiles = computed(() => consoleConfig.value?.profiles ?? []);
const agents = computed(() => consoleConfig.value?.agents ?? null);
const agentsAvailable = computed(() => agents.value?.available === true);
const authoring = computed(() => consoleConfig.value?.authoring ?? null);
const authoringAvailable = computed(() => authoring.value?.available === true);

// Whether each kind of run can start on this console at all.
const AVAILABLE: Record<IRunKindChoice, () => boolean> = {
  tests: () => true,
  agent: () => agentsAvailable.value,
  author: () => authoringAvailable.value,
};
// Why a kind cannot start here, for its tooltip: the console's reason may name a setting, so it
// is never shown in the dialog itself.
const UNAVAILABLE_WORDS: Record<IRunKindChoice, () => string> = {
  tests: () => "",
  agent: () =>
    agents.value?.reason
      ? `No agent checks here: ${agents.value.reason}.`
      : "No agent checks on this console.",
  author: () =>
    authoring.value?.reason
      ? `No tests written with AI here: ${authoring.value.reason}.`
      : "No tests written with AI on this console.",
};
const pills = computed(() => PILLS[kind.value]);
const modelInfo = computed(() =>
  agents.value?.models.find((candidate) => candidate.id === model.value)
);
const environmentInfo = computed(() => environmentNamed(environment.value));
const profileInfo = computed(() =>
  profiles.value.find((candidate) => candidate.name === profile.value)
);
const guarded = computed(() => environmentInfo.value?.guarded ?? false);
const fromGit = computed(() => consoleConfig.value?.testsFrom === "git");
const {
  branches,
  loading: branchesLoading,
  error: branchesError,
} = useBranches(() => newRunOpen.value && fromGit.value);
// Another branch than the environment's own (prod tests main) deserves a word.
const offBranch = computed(
  () =>
    fromGit.value &&
    environmentInfo.value !== undefined &&
    branch.value !== "" &&
    branch.value !== environmentInfo.value.branch
);
const busyWith = computed(() => activeRunOn(environment.value));
// Only CI runs the console follows hold the environment: an operator may start alongside them.
const heldByCi = computed(() => {
  const going = activeRunsOn(environment.value);
  return going.length > 0 && going.every((run) => run.ci !== null);
});
const mayGoAlongside = computed(() => mayRunAlongsideCi().allowed);
const offersAlongside = computed(
  () => heldByCi.value && mayGoAlongside.value && pills.value.has("alongsideCi")
);
const goesAlongside = computed(
  () => offersAlongside.value && alongsideCi.value
);
const waits = computed(
  () => busyWith.value !== undefined && !goesAlongside.value
);
// CI on the same environment uses the same QA account and API limit (no word while the run
// waits for that CI run anyway).
const ciGoing = computed(() => activeCiOn(environment.value));
const ciWarning = computed(
  () => ciGoing.value !== undefined && !(heldByCi.value && waits.value)
);

const {
  tests: catalog,
  loading: catalogLoading,
  error: catalogError,
  reload: reloadCatalog,
} = useCatalog(
  environment,
  profile,
  () => (fromGit.value && branch.value !== "" ? branch.value : null),
  () => newRunOpen.value && kind.value === "tests" && mode.value !== "all"
);

const {
  skills,
  loading: skillsLoading,
  error: skillsError,
  spend,
  reload: reloadSkills,
} = useAgentSkills(
  environment,
  () => (fromGit.value && branch.value !== "" ? branch.value : null),
  () => newRunOpen.value && kind.value === "agent"
);
// A skill the branch no longer has (or cannot run) is not kept.
watch(skills, (listed) => {
  if (
    !listed.some(
      (entry) => entry.name === skill.value && entry.unavailable === null
    )
  ) {
    skill.value = "";
  }
});

// Each environment starts on its own branch.
watch(
  environment,
  (name) => {
    branch.value = environmentNamed(name)?.branch ?? "";
  },
  { immediate: true }
);

// It opens on the environment it was asked for, else where it was last, else the default.
watch(newRunOpen, (isOpen) => {
  const config = consoleConfig.value;
  if (!isOpen || config === null) {
    return;
  }
  const wanted =
    newRunEnvironment.value ?? (environment.value || config.defaultEnvironment);
  environment.value = permitted.value.has(wanted)
    ? wanted
    : [...permitted.value][0] ?? wanted;
  profile.value = profile.value || config.defaultProfile;
  model.value = model.value || config.agents.defaultModel;
  if (!config.agents.available) {
    kind.value = "tests";
  }
  typed.value = "";
  // Opened from a skill's page: an agent check of it, on the branch the page shows.
  const preset = newRunPreset.value;
  newRunPreset.value = null;
  if (preset !== null && config.agents.available) {
    kind.value = "agent";
    skill.value = preset.skill;
    skillArguments.value = "";
    const presetBranch = preset.branch;
    if (presetBranch !== null) {
      // After the environment's watcher has set its own branch.
      void nextTick(() => {
        branch.value = presetBranch;
      });
    }
  }
});

watch([environment, profile, branch], () => {
  picked.value = [];
  tags.value = [];
  skipNeeds.value = false;
});

watch(environment, () => {
  alongsideCi.value = false;
  typed.value = "";
});

const tagCounts = computed((): ITagCount[] => {
  const counts = new Map<string, number>();
  for (const test of catalog.value) {
    for (const tag of test.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((left, right) => left.tag.localeCompare(right.tag));
});

// The tests each mode takes; null: the whole profile.
const CHOSEN: Record<ISelectionMode, () => ICatalogTest[] | null> = {
  all: () => null,
  pick: () =>
    catalog.value.filter((test) => picked.value.includes(test.testId)),
  tags: () =>
    catalog.value.filter((test) =>
      test.tags.some((tag) => tags.value.includes(tag))
    ),
};

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// What each mode sends: Playwright matches tags with --grep ("@tag", whole tags only).
const SELECTIONS: Record<ISelectionMode, () => IStartRunRequest["selection"]> =
  {
    all: () => undefined,
    pick: () => ({ testIds: picked.value }),
    tags: () => ({
      grep: `(?:${tags.value
        .map((tag) => `@${escapeRegExp(tag)}`)
        .join("|")})(?![\\w-])`,
    }),
  };

const chosen = computed(() => CHOSEN[mode.value]());

const needTiers = computed(() => {
  const tests = chosen.value;
  if (tests === null) {
    return [];
  }
  return [
    ...new Set(
      tests.flatMap((test) => tierNamed(tierOf(test.project))?.needs ?? [])
    ),
  ];
});

const summary = computed(() => {
  const tests = chosen.value;
  if (tests === null) {
    return `Every ${profile.value} test`;
  }
  if (catalogLoading.value) {
    return "Listing the tests…";
  }
  return mode.value === "pick"
    ? plural(tests.length, "test picked", "tests picked")
    : plural(tests.length, "test matches", "tests match");
});

// Today's agent spend has reached the console's daily limit: no check starts until tomorrow.
const spentOut = computed(
  () => spend.value !== null && spend.value.todayUsd >= spend.value.dailyUsd
);

// What the footer says each kind of run will do.
const SUMMARIES: Record<IRunKindChoice, () => string> = {
  tests: () => summary.value,
  author: () =>
    `AI walks it on ${environment.value}, writes the YAML test and runs it once on its own`,
  agent: () =>
    skill.value === ""
      ? "Pick the skill the agent runs"
      : `Hermes runs ${[`/${skill.value}`, skillArguments.value.trim()]
          .filter((part) => part !== "")
          .join(" ")} with ${
          modelInfo.value?.label ?? model.value
        }; the run shows what it spent`,
};

const footer = computed(() => {
  const said = SUMMARIES[kind.value]();
  return waits.value
    ? `${said}. ${environment.value} is busy, so the run waits its turn.`
    : said;
});

// What each kind of run needs before it can start.
const COMPLETE: Record<IRunKindChoice, () => boolean> = {
  tests: () =>
    profile.value !== "" && (chosen.value === null || chosen.value.length > 0),
  agent: () =>
    agentsAvailable.value &&
    !spentOut.value &&
    skill.value !== "" &&
    model.value !== "",
  author: () =>
    authoringAvailable.value &&
    !guarded.value &&
    goal.value.trim().length >= GOAL_MIN &&
    goal.value.length <= GOAL_MAX &&
    !/\p{Cc}/u.test(goal.value),
};

const ready = computed(
  () =>
    !submitting.value &&
    permitted.value.has(environment.value) &&
    (!fromGit.value || branch.value !== "") &&
    COMPLETE[kind.value]() &&
    (!guarded.value || typed.value === environment.value)
);

function chooseKind(value: unknown): void {
  const found = KINDS.find(
    (option) => option.value === value && AVAILABLE[option.value]()
  );
  if (found !== undefined) {
    kind.value = found.value;
  }
}

// What starting each kind of run sends.
const STARTS: Record<IRunKindChoice, () => Promise<boolean>> = {
  tests: () => {
    const selection = SELECTIONS[mode.value]();
    const request: IStartRunRequest = {
      env: environment.value,
      profile: profile.value,
      ...(fromGit.value ? { ref: branch.value } : {}),
      ...(selection === undefined ? {} : { selection }),
      ...(needTiers.value.length > 0 && skipNeeds.value
        ? { skipNeeds: true }
        : {}),
      ...(guarded.value ? { confirm: typed.value } : {}),
      ...(goesAlongside.value ? { alongsideCi: true } : {}),
    };
    return start(request);
  },
  agent: () => {
    const request: IStartAgentRunRequest = {
      env: environment.value,
      skill: skill.value,
      model: model.value,
      ...(skillArguments.value.trim() === ""
        ? {}
        : { arguments: skillArguments.value.trim() }),
      ...(fromGit.value ? { ref: branch.value } : {}),
      ...(guarded.value ? { confirm: typed.value } : {}),
      ...(goesAlongside.value ? { alongsideCi: true } : {}),
    };
    return startAgent(request);
  },
  author: () =>
    startAuthor({ env: environment.value, goal: goal.value.trim() }),
};

// ⌘/Ctrl+Enter anywhere in the dialog starts, the same as the button (not while an input
// method is still composing the text).
function startFromKeys(event: KeyboardEvent): void {
  if (
    (event.metaKey || event.ctrlKey) &&
    event.key === "Enter" &&
    !event.isComposing
  ) {
    event.preventDefault();
    void submit();
  }
}

async function submit(): Promise<void> {
  if (!ready.value) {
    return;
  }
  submitting.value = true;
  const started = await STARTS[kind.value]();
  submitting.value = false;
  if (started) {
    newRunOpen.value = false;
  }
}
</script>

<template>
  <Dialog v-model:open="newRunOpen">
    <DialogContent
      :show-close-button="false"
      class="flex max-h-[calc(100dvh-4rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[640px] max-sm:top-auto max-sm:bottom-0 max-sm:max-h-[90dvh] max-sm:max-w-none max-sm:translate-y-0 max-sm:rounded-b-none"
    >
      <DialogTitle class="sr-only">New run</DialogTitle>
      <DialogDescription class="sr-only">{{
        modeWords.newRun
      }}</DialogDescription>
      <form
        class="flex min-h-0 min-w-0 flex-1 flex-col"
        @submit.prevent="submit"
        @keydown="startFromKeys"
      >
        <div class="flex shrink-0 items-center gap-2 px-4 pt-3">
          <ToggleGroup
            type="single"
            size="sm"
            :spacing="0.5"
            :model-value="kind"
            aria-label="Run"
            class="min-w-0"
            @update:model-value="chooseKind"
          >
            <Tooltip
              v-for="option in KINDS"
              :key="option.value"
              :disabled="AVAILABLE[option.value]()"
            >
              <TooltipTrigger as-child>
                <span
                  class="inline-flex min-w-0"
                  :tabindex="AVAILABLE[option.value]() ? undefined : 0"
                >
                  <ToggleGroupItem
                    :value="option.value"
                    :disabled="!AVAILABLE[option.value]()"
                    class="h-7 gap-1.5 px-2 text-xs data-[state=on]:bg-muted data-[state=on]:text-foreground data-[state=off]:text-muted-foreground"
                  >
                    <component
                      :is="option.icon"
                      class="size-3.5"
                      aria-hidden="true"
                    />
                    {{ option.label }}
                  </ToggleGroupItem>
                </span>
              </TooltipTrigger>
              <TooltipContent>{{
                UNAVAILABLE_WORDS[option.value]()
              }}</TooltipContent>
            </Tooltip>
          </ToggleGroup>
          <DialogClose as-child>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              class="ml-auto text-muted-foreground"
              aria-label="Close"
            >
              <XIcon aria-hidden="true" />
            </Button>
          </DialogClose>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div class="min-h-40 min-w-0 px-4 py-3">
            <NewRunAgent
              v-if="kind === 'agent'"
              v-model:skill="skill"
              v-model:arguments="skillArguments"
              :environment="environment"
              :skills="skills"
              :loading="skillsLoading"
              :error="skillsError"
              :spend="spend"
              :spent-out="spentOut"
              @reload="reloadSkills"
            />
            <NewRunAuthor
              v-else-if="kind === 'author'"
              v-model="goal"
              :environment="environment"
              :guarded="guarded"
              :max-length="GOAL_MAX"
            />
            <NewRunTests
              v-else
              v-model:mode="mode"
              v-model:picked="picked"
              v-model:tags="tags"
              :environment="environment"
              :profile="profile"
              :profile-info="profileInfo"
              :catalog="catalog"
              :loading="catalogLoading"
              :error="catalogError"
              :tag-counts="tagCounts"
              :matched="chosen?.length ?? 0"
              @reload="reloadCatalog"
            />
          </div>

          <NewRunProperties
            v-model:environment="environment"
            v-model:profile="profile"
            v-model:branch="branch"
            v-model:model="model"
            v-model:skip-needs="skipNeeds"
            v-model:alongside-ci="alongsideCi"
            :pills="pills"
            :permitted="permitted"
            :refusal="refusal"
            :refuses-guarded="kind === 'author'"
            :from-git="fromGit"
            :branches="branches"
            :branches-loading="branchesLoading"
            :off-branch="offBranch"
            :need-tiers="needTiers"
            :offers-alongside="offersAlongside"
          />

          <div
            v-if="guarded && kind !== 'author'"
            class="grid gap-1.5 px-4 pb-3"
          >
            <p :id="ids.guardedWords" class="text-xs text-flaky">
              {{ environment }} is the live product: its runs write real data
              with the shared QA account.
            </p>
            <Input
              :id="ids.confirm"
              v-model="typed"
              :placeholder="`Type ${environment} to run on it`"
              :aria-label="`Type ${environment} to run on it`"
              :aria-describedby="ids.guardedWords"
              autocomplete="off"
              autocapitalize="off"
              spellcheck="false"
              class="h-8 font-mono"
            />
          </div>

          <div
            v-if="
              (refusal !== null && !permitted.has(environment)) ||
              (fromGit &&
                pills.has('branch') &&
                (branchesError !== null || offBranch)) ||
              (ciWarning && ciGoing !== undefined)
            "
            class="grid gap-1 px-4 pb-3 text-xs"
          >
            <PermissionNote
              v-if="refusal !== null && !permitted.has(environment)"
              :permission="refusal"
              class="text-xs"
            />
            <template v-if="fromGit && pills.has('branch')">
              <p v-if="branchesError !== null" class="text-fail">
                {{ branchesError }}
              </p>
              <p v-else-if="offBranch" class="text-flaky">
                {{ environment }} normally tests
                <span class="font-mono">{{ environmentInfo?.branch }}</span
                >.
              </p>
            </template>
            <p v-if="ciWarning && ciGoing !== undefined" class="text-flaky">
              CI is running {{ ciTitle(ciGoing) }} on {{ environment }} now.
              Both runs use the same QA account and its API limit, so they slow
              each other down and may run into 429s.
            </p>
          </div>
        </div>

        <div class="flex shrink-0 items-center gap-3 border-t px-4 py-3">
          <p class="min-w-0 flex-1 text-sm text-muted-foreground">
            {{ footer }}
          </p>
          <DialogClose as-child>
            <Button type="button" variant="ghost" size="sm">Cancel</Button>
          </DialogClose>
          <Button type="submit" size="sm" :disabled="!ready">
            <PlayIcon aria-hidden="true" />
            {{ waits ? "Add to queue" : START_WORDS[kind] }}
            <kbd
              class="ml-0.5 font-sans text-xs opacity-70 max-sm:hidden"
              aria-hidden="true"
              >⌘↵</kbd
            >
          </Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>
</template>
