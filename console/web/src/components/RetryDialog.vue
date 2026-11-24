<script setup lang="ts">
import { RotateCcwIcon } from "@lucide/vue";
import { computed, ref, useId, watch } from "vue";
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
import { Switch } from "@/components/ui/switch";
import type { IRetryDraft } from "@/types";

// Asks before a retry that has a choice to make: skip the tiers its tests need (smoke before
// AI tests), or confirm a guarded environment (prod) by typing its name.

const props = defineProps<{ draft: IRetryDraft | null; environment: string }>();
const open = defineModel<boolean>("open", { required: true });
const emit = defineEmits<{
  confirm: [options: { skipNeeds: boolean; confirm: string | undefined }];
}>();

const skipNeeds = ref(false);
const typed = ref("");
const switchId = useId();
const inputId = useId();

watch(open, (isOpen) => {
  if (isOpen) {
    skipNeeds.value = false;
    typed.value = "";
  }
});

const tiers = computed(() => props.draft?.needTiers.join(" and ") ?? "");

const ready = computed(
  () =>
    props.draft !== null &&
    (!props.draft.guarded || typed.value === props.environment)
);

function submit(): void {
  if (!ready.value) {
    return;
  }
  emit("confirm", {
    skipNeeds: skipNeeds.value,
    confirm: props.draft?.guarded === true ? typed.value : undefined,
  });
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-md">
      <form
        v-if="draft !== null"
        class="grid min-w-0 gap-4"
        @submit.prevent="submit"
      >
        <DialogHeader>
          <DialogTitle>{{ draft.title }}</DialogTitle>
          <DialogDescription>{{ draft.description }}</DialogDescription>
        </DialogHeader>

        <div
          v-if="draft.needTiers.length > 0"
          class="flex items-center justify-between gap-4 rounded-md px-3 py-2.5 ring-1 ring-border"
        >
          <div class="grid min-w-0 gap-1">
            <Label :for="switchId">Skip {{ tiers }} first</Label>
            <p class="text-xs text-muted-foreground">
              They normally wait for the whole {{ tiers }} tier to pass.
            </p>
          </div>
          <Switch :id="switchId" v-model="skipNeeds" />
        </div>

        <div v-if="draft.guarded" class="grid gap-1.5">
          <Label :for="inputId"
            >Type <span class="font-mono">{{ environment }}</span> to go
            on</Label
          >
          <Input
            :id="inputId"
            v-model="typed"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
          />
          <p class="text-xs text-muted-foreground">
            {{ environment }} is guarded: its runs write real data with the
            shared QA account.
          </p>
        </div>

        <DialogFooter>
          <DialogClose as-child>
            <Button type="button" variant="ghost" size="sm">Cancel</Button>
          </DialogClose>
          <Button type="submit" size="sm" :disabled="!ready">
            <RotateCcwIcon aria-hidden="true" />
            Retry
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
