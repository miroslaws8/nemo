<script setup lang="ts">
import { BotIcon, GitBranchIcon, LayersIcon, LockIcon } from "@lucide/vue";
import type { IBranch } from "@shared/types";
import { computed } from "vue";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { TONE_CLASSES } from "@/lib/status";
import { consoleConfig, environmentNamed } from "@/state/config";
import { toneOfEnvironment } from "@/state/runs";
import { modeWords } from "@/state/session";
import type { INewRunPill, IPermission } from "@/types";
import PermissionNote from "./PermissionNote.vue";
import RunPropertyPill from "./RunPropertyPill.vue";

// The New run dialog's property bar: a pill for the environment, and for each property the kind
// of run takes (`pills`) that applies here, each opening its menu or turning an option on.

const props = defineProps<{
  pills: ReadonlySet<INewRunPill>;
  // The environments this person may run on, and why some are greyed out.
  permitted: ReadonlySet<string>;
  refusal: IPermission | null;
  // Guarded environments are greyed out (a test written with AI).
  refusesGuarded: boolean;
  fromGit: boolean;
  branches: IBranch[];
  branchesLoading: boolean;
  offBranch: boolean;
  needTiers: string[];
  offersAlongside: boolean;
}>();
const environment = defineModel<string>("environment", { required: true });
const profile = defineModel<string>("profile", { required: true });
const branch = defineModel<string>("branch", { required: true });
const model = defineModel<string>("model", { required: true });
const skipNeeds = defineModel<boolean>("skipNeeds", { required: true });
const alongsideCi = defineModel<boolean>("alongsideCi", { required: true });

const environments = computed(() => consoleConfig.value?.environments ?? []);
const profiles = computed(() => consoleConfig.value?.profiles ?? []);
const models = computed(() => consoleConfig.value?.agents.models ?? []);
const guarded = computed(
  () => environmentNamed(environment.value)?.guarded ?? false
);
const modelInfo = computed(() =>
  models.value.find((candidate) => candidate.id === model.value)
);
const chosenBranch = computed(() =>
  props.branches.find((candidate) => candidate.name === branch.value)
);

// The host an environment's base URL points at, for its menu item.
function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

function chooseEnvironment(value: unknown): void {
  if (typeof value === "string" && value !== "") {
    environment.value = value;
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

function chooseModel(value: unknown): void {
  if (typeof value === "string" && value !== "") {
    model.value = value;
  }
}
</script>

<template>
  <div class="flex flex-wrap gap-1.5 px-4 pb-3">
    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <RunPropertyPill :aria-label="`Environment: ${environment}`">
          <span
            class="size-2 shrink-0 rounded-full"
            :class="TONE_CLASSES[toneOfEnvironment(environment)].bar"
            aria-hidden="true"
          />
          <span class="truncate">{{ environment }}</span>
          <LockIcon v-if="guarded" class="text-faint" aria-label="guarded" />
        </RunPropertyPill>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" class="w-72 max-w-[90vw]">
        <DropdownMenuLabel class="text-xs font-normal text-muted-foreground">{{
          modeWords.newRun
        }}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          :model-value="environment"
          @update:model-value="chooseEnvironment"
        >
          <DropdownMenuRadioItem
            v-for="entry in environments"
            :key="entry.name"
            :value="entry.name"
            :disabled="
              !permitted.has(entry.name) || (refusesGuarded && entry.guarded)
            "
          >
            <span class="grid min-w-0">
              <span class="flex items-center gap-2">
                <span
                  class="size-2 shrink-0 rounded-full"
                  :class="TONE_CLASSES[toneOfEnvironment(entry.name)].bar"
                  aria-hidden="true"
                />
                {{ entry.name }}
                <LockIcon
                  v-if="entry.guarded"
                  class="size-3 text-faint"
                  aria-label="guarded"
                />
              </span>
              <span class="truncate font-mono text-xs text-faint">{{
                hostOf(entry.baseUrl)
              }}</span>
            </span>
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <template v-if="refusal !== null">
          <DropdownMenuSeparator />
          <PermissionNote :permission="refusal" class="px-2 py-1.5 text-xs" />
        </template>
      </DropdownMenuContent>
    </DropdownMenu>

    <DropdownMenu v-if="pills.has('profile')">
      <DropdownMenuTrigger as-child>
        <RunPropertyPill :aria-label="`Profile: ${profile}`">
          <LayersIcon class="text-muted-foreground" aria-hidden="true" />
          <span class="truncate">{{ profile || "Profile" }}</span>
        </RunPropertyPill>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" class="w-72 max-w-[90vw]">
        <DropdownMenuRadioGroup
          :model-value="profile"
          @update:model-value="chooseProfile"
        >
          <DropdownMenuRadioItem
            v-for="entry in profiles"
            :key="entry.name"
            :value="entry.name"
          >
            <span class="grid min-w-0">
              <span>{{ entry.name }}</span>
              <span class="text-xs text-muted-foreground">
                {{ entry.description }}
                Tiers: {{ entry.tiers.join(", ") }}.
              </span>
            </span>
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>

    <DropdownMenu v-if="fromGit && pills.has('branch')">
      <DropdownMenuTrigger as-child>
        <RunPropertyPill :aria-label="`Branch: ${branch}`">
          <GitBranchIcon class="text-muted-foreground" aria-hidden="true" />
          <span class="truncate" :class="{ 'text-flaky': offBranch }">{{
            branch || (branchesLoading ? "Getting the branches…" : "Branch")
          }}</span>
        </RunPropertyPill>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" class="max-h-80 w-72 max-w-[90vw]">
        <DropdownMenuLabel
          v-if="chosenBranch !== undefined"
          class="flex min-w-0 gap-2 text-xs font-normal text-muted-foreground"
        >
          <span class="shrink-0 font-mono">{{
            chosenBranch.sha.slice(0, 7)
          }}</span>
          <span class="truncate">{{ chosenBranch.subject }}</span>
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          :model-value="branch"
          @update:model-value="chooseBranch"
        >
          <DropdownMenuRadioItem
            v-for="entry in branches"
            :key="entry.name"
            :value="entry.name"
          >
            <span class="truncate">{{ entry.name }}</span>
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>

    <DropdownMenu v-if="pills.has('model')">
      <DropdownMenuTrigger as-child>
        <RunPropertyPill :aria-label="`Model: ${modelInfo?.label ?? model}`">
          <BotIcon class="text-muted-foreground" aria-hidden="true" />
          <span class="truncate">{{
            modelInfo?.label ?? (model || "Model")
          }}</span>
        </RunPropertyPill>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" class="w-72 max-w-[90vw]">
        <DropdownMenuLabel class="text-xs font-normal text-muted-foreground">
          The model reads the pages and decides each step; every check spends
          tokens on the console's
          {{ modelInfo?.provider || "model" }} key.
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          :model-value="model"
          @update:model-value="chooseModel"
        >
          <DropdownMenuRadioItem
            v-for="entry in models"
            :key="entry.id"
            :value="entry.id"
            :disabled="!entry.available"
          >
            {{ entry.label }}
            <span
              v-if="!entry.available"
              class="ml-auto text-xs text-muted-foreground"
              >no {{ entry.provider || "model" }} key</span
            >
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>

    <Tooltip v-if="pills.has('skipNeeds') && needTiers.length > 0">
      <TooltipTrigger as-child>
        <RunPropertyPill :pressed="skipNeeds" @click="skipNeeds = !skipNeeds">
          Skip {{ needTiers.join(" and ") }} first
        </RunPropertyPill>
      </TooltipTrigger>
      <TooltipContent>
        Some of these tests wait for the whole
        {{ needTiers.join(" and ") }} tier to pass. Skip it to run only what you
        picked.
      </TooltipContent>
    </Tooltip>

    <Tooltip v-if="offersAlongside">
      <TooltipTrigger as-child>
        <RunPropertyPill
          :pressed="alongsideCi"
          @click="alongsideCi = !alongsideCi"
        >
          Start alongside CI
        </RunPropertyPill>
      </TooltipTrigger>
      <TooltipContent>
        CI is testing {{ environment }}. Off, the run waits until CI is done.
      </TooltipContent>
    </Tooltip>
  </div>
</template>
