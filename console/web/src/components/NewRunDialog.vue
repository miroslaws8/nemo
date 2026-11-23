<script setup lang="ts">
import {
  BotIcon,
  GitBranchIcon,
  ListChecksIcon,
  LockIcon,
  PlayIcon,
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useAgentSkills } from "@/composables/useAgentSkills";
import { useBranches } from "@/composables/useBranches";
import { useCatalog } from "@/composables/useCatalog";
import { useRunActions } from "@/composables/useRunActions";
import { formatUsd, plural, tierOf } from "@/lib/format";
import { mayActOn, mayRunAlongsideCi } from "@/state/access";
import { consoleConfig, environmentNamed, tierNamed } from "@/state/config";
import { newRunEnvironment, newRunOpen, newRunPreset } from "@/state/dialogs";
import { ciTitle } from "@/lib/ci";
import { activeCiOn } from "@/state/ci";
import { activeRunOn, activeRunsOn } from "@/state/runs";
import { modeWords } from "@/state/session";
import type { IRunKindChoice, ISelectionMode, ITagCount } from "@/types";
import AgentSkillPicker from "./AgentSkillPicker.vue";
import PermissionNote from "./PermissionNote.vue";
import TagPicker from "./TagPicker.vue";
import TestPicker from "./TestPicker.vue";

// Starts a run: an environment, a profile, and all of its tests, some picked by hand or the
// ones with given tags — or an agent check: Hermes Agent runs one of the skills with a model. A
// server console runs a branch (the environment's own by default). A guarded environment (prod)
// asks for its name. A run waits while CI runs hold its environment; an operator may start it
// alongside them.

// What a run can be, the agent check first (the dialog opens on it where the console has agents);
// each with its icon, and whether it needs the console's agent checks.
const KINDS: {
  value: IRunKindChoice;
  label: string;
  icon: Component;
  needsAgents: boolean;
}[] = [
  { value: "agent", label: "Agent check", icon: BotIcon, needsAgents: true },
  {
    value: "tests",
    label: "Scripted tests",
    icon: ListChecksIcon,
    needsAgents: false,
  },
];

const START_WORDS: Record<IRunKindChoice, string> = {
  tests: "Start run",
  agent: "Start check",
};

const MODES: { value: ISelectionMode; label: string }[] = [
  { value: "all", label: "All tests of the profile" },
  { value: "pick", label: "Pick tests" },
  { value: "tags", label: "By tag" },
];

const { start, startAgent } = useRunActions();

const kind = ref<IRunKindChoice>("agent");
const skill = ref("");
const model = ref("");
// One line for the skill after the environment (e.g. an asset type).
const skillArguments = ref("");
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
const ids = {
  environment: useId(),
  profile: useId(),
  mode: useId(),
  skip: useId(),
  alongside: useId(),
  confirm: useId(),
  branch: useId(),
  kind: useId(),
  model: useId(),
  arguments: useId(),
};

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
const chosenBranch = computed(() =>
  branches.value.find((candidate) => candidate.name === branch.value)
);
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
const goesAlongside = computed(
  () => heldByCi.value && mayGoAlongside.value && alongsideCi.value
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
};

const ready = computed(
  () =>
    !submitting.value &&
    permitted.value.has(environment.value) &&
    (!fromGit.value || branch.value !== "") &&
    COMPLETE[kind.value]() &&
    (!guarded.value || typed.value === environment.value)
);

function chooseEnvironment(value: unknown): void {
  if (typeof value === "string" && value !== "") {
    environment.value = value;
    typed.value = "";
  }
}

function chooseBranch(value: unknown): void {
  if (typeof value === "string" && value !== "") {
    branch.value = value;
  }
}

function chooseProfile(value: unknown): void {
  if (typeof value === "string") {
    profile.value = value;
  }
}

function chooseKind(value: unknown): void {
  const found = KINDS.find((option) => option.value === value);
  if (found !== undefined) {
    kind.value = found.value;
  }
}

function chooseModel(value: unknown): void {
  if (typeof value === "string" && value !== "") {
    model.value = value;
  }
}

function chooseMode(value: unknown): void {
  const found = MODES.find((option) => option.value === value);
  if (found !== undefined) {
    mode.value = found.value;
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
};

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
    <DialogContent class="sm:max-w-2xl">
      <form class="grid min-w-0 gap-6" @submit.prevent="submit">
        <DialogHeader>
          <DialogTitle>New run</DialogTitle>
          <DialogDescription>{{ modeWords.newRun }}</DialogDescription>
        </DialogHeader>

        <div class="grid min-w-0 gap-2">
          <Label :id="ids.kind">Run</Label>
          <ToggleGroup
            type="single"
            variant="outline"
            :model-value="kind"
            :aria-labelledby="ids.kind"
            class="w-full sm:w-auto sm:justify-self-start"
            @update:model-value="chooseKind"
          >
            <ToggleGroupItem
              v-for="option in KINDS"
              :key="option.value"
              :value="option.value"
              :disabled="option.needsAgents && !agentsAvailable"
              class="flex-1 gap-1.5 px-4"
            >
              <component :is="option.icon" class="size-4" aria-hidden="true" />
              {{ option.label }}
            </ToggleGroupItem>
          </ToggleGroup>
          <p v-if="kind === 'agent'" class="text-xs text-muted-foreground">
            Hermes Agent opens the app in a browser and follows one of the
            skills in hermes/skills, the way a tester would. Its report and
            screenshots land in the run.
          </p>
          <p v-else class="text-xs text-muted-foreground">
            Playwright runs the YAML tests of a profile, the same steps every
            time: all of them, some picked by hand, or the ones with a tag.
            <template v-if="!agentsAvailable && agents?.reason">
              No agent checks here: {{ agents.reason }}.
            </template>
          </p>
        </div>

        <div class="grid min-w-0 gap-5 sm:grid-cols-2">
          <div class="grid min-w-0 content-start gap-2">
            <Label :id="ids.environment">Environment</Label>
            <ToggleGroup
              type="single"
              variant="outline"
              :model-value="environment"
              :aria-labelledby="ids.environment"
              class="w-full"
              @update:model-value="chooseEnvironment"
            >
              <ToggleGroupItem
                v-for="entry in environments"
                :key="entry.name"
                :value="entry.name"
                :disabled="!permitted.has(entry.name)"
                class="flex-1 gap-1.5"
              >
                {{ entry.name }}
                <LockIcon
                  v-if="entry.guarded"
                  class="size-3.5"
                  aria-label="guarded"
                />
              </ToggleGroupItem>
            </ToggleGroup>
            <p class="truncate text-xs text-muted-foreground">
              {{ environmentInfo?.baseUrl }}
            </p>
            <PermissionNote
              v-if="refusal !== null"
              :permission="refusal"
              class="text-xs"
            />
          </div>

          <div v-if="kind === 'agent'" class="grid min-w-0 content-start gap-2">
            <Label :for="ids.model">Model</Label>
            <Select :model-value="model" @update:model-value="chooseModel">
              <SelectTrigger :id="ids.model" class="w-full">
                <SelectValue placeholder="Pick a model" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="entry in agents?.models ?? []"
                  :key="entry.id"
                  :value="entry.id"
                  :disabled="!entry.available"
                >
                  {{ entry.label }}
                  <span
                    v-if="entry.reason !== null"
                    class="text-xs text-muted-foreground"
                    >{{ entry.reason }}</span
                  >
                </SelectItem>
              </SelectContent>
            </Select>
            <p class="text-xs text-muted-foreground">
              The model reads the pages and decides each step. Every check
              spends tokens on the console's
              {{ modelInfo?.provider || "model" }}
              key.
            </p>
            <p
              v-if="spend !== null"
              class="text-xs tabular-nums"
              :class="spentOut ? 'text-fail' : 'text-muted-foreground'"
            >
              {{
                spentOut
                  ? `Today's limit is spent (${formatUsd(
                      spend.todayUsd
                    )} of ${formatUsd(
                      spend.dailyUsd
                    )}): checks start again tomorrow (UTC).`
                  : `Spent today: ${formatUsd(spend.todayUsd)} of ${formatUsd(
                      spend.dailyUsd
                    )}.`
              }}
            </p>
          </div>

          <div v-else class="grid min-w-0 content-start gap-2">
            <Label :for="ids.profile">Profile</Label>
            <Select :model-value="profile" @update:model-value="chooseProfile">
              <SelectTrigger :id="ids.profile" class="w-full">
                <SelectValue placeholder="Pick a profile" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="entry in profiles"
                  :key="entry.name"
                  :value="entry.name"
                >
                  {{ entry.name }}
                </SelectItem>
              </SelectContent>
            </Select>
            <p
              v-if="profileInfo !== undefined"
              class="text-xs text-muted-foreground"
            >
              {{ profileInfo.description }}
              Tiers: {{ profileInfo.tiers.join(", ") }}.
            </p>
          </div>
        </div>

        <div v-if="fromGit" class="grid min-w-0 gap-2">
          <Label :for="ids.branch">Branch</Label>
          <Select :model-value="branch" @update:model-value="chooseBranch">
            <SelectTrigger :id="ids.branch" class="w-full">
              <span class="flex min-w-0 items-center gap-2">
                <GitBranchIcon
                  class="size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <SelectValue
                  :placeholder="
                    branchesLoading ? 'Getting the branches…' : 'Pick a branch'
                  "
                />
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="entry in branches"
                :key="entry.name"
                :value="entry.name"
              >
                {{ entry.name }}
              </SelectItem>
            </SelectContent>
          </Select>
          <p v-if="branchesError !== null" class="text-xs text-fail">
            {{ branchesError }}
          </p>
          <p
            v-else-if="chosenBranch !== undefined"
            class="flex min-w-0 gap-2 text-xs text-muted-foreground"
          >
            <span class="shrink-0 font-mono">{{
              chosenBranch.sha.slice(0, 7)
            }}</span>
            <span class="truncate">{{ chosenBranch.subject }}</span>
          </p>
          <p v-if="offBranch" class="text-xs text-flaky">
            {{ environment }} normally tests
            <span class="font-mono">{{ environmentInfo?.branch }}</span
            >.
          </p>
        </div>

        <template v-if="kind === 'agent'">
          <AgentSkillPicker
            v-model="skill"
            :skills="skills"
            :loading="skillsLoading"
            :error="skillsError"
            @reload="reloadSkills"
          />
          <div class="grid min-w-0 gap-2">
            <Label :for="ids.arguments">Arguments (optional)</Label>
            <Input
              :id="ids.arguments"
              v-model="skillArguments"
              maxlength="200"
              autocomplete="off"
              spellcheck="false"
              placeholder="e.g. hero"
            />
            <p class="text-xs text-muted-foreground">
              What the skill gets after the environment:
              <span class="font-mono"
                >/{{ skill || "skill" }} {{ environment }}
                {{ skillArguments.trim() || "…" }}</span
              >
            </p>
          </div>
        </template>

        <div v-else class="grid min-w-0 gap-3">
          <Label :id="ids.mode">Tests</Label>
          <RadioGroup
            :model-value="mode"
            :aria-labelledby="ids.mode"
            class="flex flex-wrap gap-x-6 gap-y-2"
            @update:model-value="chooseMode"
          >
            <div
              v-for="option in MODES"
              :key="option.value"
              class="flex items-center gap-2"
            >
              <RadioGroupItem
                :id="`${ids.mode}-${option.value}`"
                :value="option.value"
              />
              <Label :for="`${ids.mode}-${option.value}`" class="font-normal">{{
                option.label
              }}</Label>
            </div>
          </RadioGroup>

          <template v-if="mode !== 'all'">
            <div v-if="catalogLoading" class="grid gap-2" aria-busy="true">
              <p class="text-sm text-muted-foreground">
                Listing the {{ environment }} × {{ profile }} tests…
              </p>
              <Skeleton class="h-9 w-full" />
              <Skeleton class="h-40 w-full" />
            </div>
            <div
              v-else-if="catalogError !== null"
              class="flex flex-wrap items-center gap-3 rounded-md border border-fail/30 px-3 py-2.5 text-sm"
            >
              <p class="min-w-0 flex-1 text-fail">{{ catalogError }}</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                @click="reloadCatalog"
              >
                Try again
              </Button>
            </div>
            <TestPicker
              v-else-if="mode === 'pick'"
              v-model="picked"
              :tests="catalog"
            />
            <TagPicker
              v-else
              v-model="tags"
              :tags="tagCounts"
              :matched="chosen?.length ?? 0"
            />
          </template>
        </div>

        <div
          v-if="kind === 'tests' && needTiers.length > 0"
          class="flex items-start justify-between gap-4 rounded-md border p-3"
        >
          <div class="grid gap-1">
            <Label :for="ids.skip"
              >Skip {{ needTiers.join(" and ") }} first</Label
            >
            <p class="text-sm text-muted-foreground">
              Some of these tests wait for the whole
              {{ needTiers.join(" and ") }} tier to pass. Skip it to run only
              what you picked.
            </p>
          </div>
          <Switch :id="ids.skip" v-model="skipNeeds" />
        </div>

        <div
          v-if="guarded"
          class="grid gap-2 rounded-md border border-flaky/40 bg-flaky/5 p-3"
        >
          <p class="text-sm">
            {{ environment }} is the live product: its runs write real data with
            the shared QA account.
          </p>
          <Label :for="ids.confirm"
            >Type <span class="font-mono">{{ environment }}</span> to
            start</Label
          >
          <Input
            :id="ids.confirm"
            v-model="typed"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
          />
        </div>

        <div
          v-if="heldByCi && mayGoAlongside"
          class="flex items-start justify-between gap-4 rounded-md border p-3"
        >
          <div class="grid gap-1">
            <Label :for="ids.alongside">Start now, alongside CI</Label>
            <p class="text-sm text-muted-foreground">
              CI is testing {{ environment }}. Off, the run waits until CI is
              done.
            </p>
          </div>
          <Switch :id="ids.alongside" v-model="alongsideCi" />
        </div>

        <p
          v-if="ciWarning && ciGoing !== undefined"
          class="rounded-md border border-flaky/40 bg-flaky/5 px-3 py-2 text-sm"
        >
          CI is running {{ ciTitle(ciGoing) }} on {{ environment }} now. Both
          runs use the same QA account and its API limit, so they slow each
          other down and may run into 429s.
        </p>

        <DialogFooter class="items-center gap-3 sm:justify-between">
          <p class="text-sm text-muted-foreground">
            {{ footer }}
          </p>
          <div class="flex gap-2">
            <DialogClose as-child>
              <Button type="button" variant="ghost">Cancel</Button>
            </DialogClose>
            <Button type="submit" :disabled="!ready">
              <PlayIcon aria-hidden="true" />
              {{ waits ? "Add to queue" : START_WORDS[kind] }}
            </Button>
          </div>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
