<script setup lang="ts">
import type { IAgentSkills, IAgentSpend } from "@shared/types";
import { computed, useId } from "vue";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatUsd } from "@/lib/format";
import AgentSkillPicker from "./AgentSkillPicker.vue";

// The New run dialog's body for an agent check: the skill Hermes runs, the line it gets after the
// environment, and what checks spent today against the console's daily limit.

const props = defineProps<{
  environment: string;
  skills: IAgentSkills["skills"];
  loading: boolean;
  error: string | null;
  spend: IAgentSpend | null;
  spentOut: boolean;
}>();
const skill = defineModel<string>("skill", { required: true });
const skillArguments = defineModel<string>("arguments", { required: true });
const emit = defineEmits<{ reload: [] }>();

const argumentsId = useId();

// The arguments are one line: a line break (typed or pasted) becomes a space.
function setArguments(value: string | number): void {
  skillArguments.value = String(value).replace(/\p{Cc}+/gu, " ");
}

const spendWords = computed(() => {
  const spend = props.spend;
  if (spend === null) {
    return null;
  }
  const spent = `${formatUsd(spend.todayUsd)} of ${formatUsd(spend.dailyUsd)}`;
  return props.spentOut
    ? `Today's limit is spent (${spent}): checks start again tomorrow (UTC).`
    : `Spent today: ${spent}.`;
});
</script>

<template>
  <div class="grid min-w-0 content-start gap-3">
    <AgentSkillPicker
      v-model="skill"
      :skills="skills"
      :loading="loading"
      :error="error"
      @reload="emit('reload')"
    />
    <div class="grid min-w-0 gap-1">
      <Label :for="argumentsId" class="sr-only">Arguments (optional)</Label>
      <Textarea
        :id="argumentsId"
        :model-value="skillArguments"
        maxlength="200"
        rows="1"
        autocomplete="off"
        spellcheck="false"
        class="min-h-0 resize-none rounded-none border-0 bg-transparent px-0 py-1 shadow-none focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent"
        placeholder="Arguments for the skill (optional), e.g. hero"
        @update:model-value="setArguments"
        @keydown.enter.exact.prevent
      />
      <p class="truncate font-mono text-xs text-faint">
        /{{ skill || "skill" }} {{ environment }}
        {{ skillArguments.trim() || "…" }}
      </p>
    </div>
    <p
      v-if="spendWords !== null"
      class="text-xs tabular-nums"
      :class="spentOut ? 'text-fail' : 'text-muted-foreground'"
    >
      {{ spendWords }}
    </p>
  </div>
</template>
