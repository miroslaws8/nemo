<script setup lang="ts">
import { useId } from "vue";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

// The New run dialog's body for a test written with AI: what to check, in a person's words.

defineProps<{ environment: string; guarded: boolean; maxLength: number }>();
const goal = defineModel<string>({ required: true });

const goalId = useId();

// A description is one paragraph: a line break (typed or pasted) becomes a space.
function setGoal(value: string | number): void {
  goal.value = String(value).replace(/\p{Cc}+/gu, " ");
}
</script>

<template>
  <div class="grid min-w-0 content-start gap-2">
    <Label :for="goalId" class="sr-only">What to check</Label>
    <Textarea
      :id="goalId"
      :model-value="goal"
      :maxlength="maxLength"
      class="min-h-28 resize-none rounded-none border-0 bg-transparent px-0 py-1 shadow-none focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent"
      placeholder="On a phone, the menu leads to the pricing page and its plans are shown"
      @update:model-value="setGoal"
      @keydown.enter.exact.prevent
    />
    <p v-if="guarded" class="text-xs text-flaky">
      Not on {{ environment }}: tests are written on an environment that is not
      guarded, and run on {{ environment }} too.
    </p>
    <p v-else class="text-xs text-muted-foreground">
      In plain words, like you would tell a tester. AI walks it in the browser,
      keeps what worked, adds the checks that prove it and runs the test once;
      then you add it to the tests.
    </p>
  </div>
</template>
