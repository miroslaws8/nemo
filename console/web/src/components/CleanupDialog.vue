<script setup lang="ts">
import { Trash2Icon } from "@lucide/vue";
import type { ISweepResult } from "@shared/types";
import { computed, ref, useId, watch } from "vue";
import { toast } from "vue-sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { formatClock, plural } from "@/lib/format";
import { isGuarded } from "@/state/config";
import type { ICleanupPhase } from "@/types";

// Finds the records a run (local or CI) left behind — named "<data prefix><run id> …", owned by
// the test user — and deletes them on request: the guarded sweep of `pnpm sweep --run <id>`.

const props = defineProps<{
  env: string;
  // Whose data, as the dialog names it: "this run", "pipeline #123".
  owner: string;
  // The person may not clean up there (their role): the button is greyed out.
  disabled?: boolean;
  perform: (
    apply: boolean,
    confirm: string | undefined
  ) => Promise<ISweepResult | null>;
}>();

const open = ref(false);
const phase = ref<ICleanupPhase>("looking");
const result = ref<ISweepResult | null>(null);
const typed = ref("");
const deleted = ref(0);
const inputId = useId();

const guarded = computed(() => isGuarded(props.env));
const count = computed(() => result.value?.candidates.length ?? 0);
const canDelete = computed(
  () =>
    phase.value === "found" &&
    count.value > 0 &&
    result.value?.refusal === null &&
    (!guarded.value || typed.value === props.env)
);

async function look(): Promise<void> {
  phase.value = "looking";
  result.value = null;
  typed.value = "";
  const found = await props.perform(false, undefined);
  result.value = found;
  phase.value = found === null ? "failed" : "found";
}

async function remove(): Promise<void> {
  const deleting = count.value;
  phase.value = "deleting";
  const done = await props.perform(
    true,
    guarded.value ? typed.value : undefined
  );
  if (done === null) {
    phase.value = "found";
    return;
  }
  result.value = done;
  deleted.value = deleting;
  phase.value = "done";
  toast.success(
    `Deleted ${plural(deleting, "record", "records")} on ${props.env}`
  );
}

watch(open, (isOpen) => {
  if (isOpen) {
    void look();
  }
});
</script>

<template>
  <Dialog v-model:open="open">
    <DialogTrigger as-child>
      <Button variant="outline" :disabled="disabled">
        <Trash2Icon aria-hidden="true" />
        Clean up
      </Button>
    </DialogTrigger>
    <DialogContent class="sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>Clean up after {{ owner }}</DialogTitle>
        <DialogDescription>
          Looks on {{ env }} for records {{ owner }} created and left behind:
          named after its id and owned by the test user. Nothing else is
          touched.
        </DialogDescription>
      </DialogHeader>

      <div class="min-w-0 text-sm">
        <div v-if="phase === 'looking'" class="space-y-2" aria-busy="true">
          <p class="text-muted-foreground">Looking on {{ env }}…</p>
          <Skeleton class="h-4 w-3/4" />
          <Skeleton class="h-4 w-2/3" />
        </div>

        <p v-else-if="phase === 'failed'" class="text-fail">
          The search did not finish. Try again in a moment.
        </p>

        <template v-else-if="result !== null">
          <p v-if="phase === 'done'" class="mb-2 text-pass">
            Deleted {{ plural(deleted, "record", "records") }}.
          </p>
          <p v-else-if="count === 0" class="text-muted-foreground">
            Nothing left: the tests deleted what they created.
          </p>

          <ul
            v-if="phase !== 'done' && count > 0"
            class="max-h-64 divide-y overflow-auto rounded-md border"
          >
            <li
              v-for="candidate in result.candidates"
              :key="`${candidate.kind}-${candidate.id}`"
              class="flex items-baseline gap-3 px-3 py-2"
            >
              <span class="w-24 shrink-0 text-muted-foreground">{{
                candidate.kind
              }}</span>
              <span class="min-w-0 flex-1 truncate" :title="candidate.title">{{
                candidate.title
              }}</span>
              <span
                v-if="candidate.createdAt !== null"
                class="shrink-0 tabular-nums text-muted-foreground"
                >{{ formatClock(candidate.createdAt) }}</span
              >
            </li>
          </ul>

          <ul
            v-if="phase === 'done' && result.outcomes.length > 0"
            class="max-h-64 space-y-1 overflow-auto font-mono text-xs"
          >
            <li v-for="outcome in result.outcomes" :key="outcome">
              {{ outcome }}
            </li>
          </ul>

          <p
            v-if="result.refusal !== null"
            class="mt-3 rounded-md bg-flaky/10 px-3 py-2 text-flaky"
          >
            {{ result.refusal }}
          </p>

          <div
            v-if="guarded && phase === 'found' && count > 0"
            class="mt-4 grid gap-2"
          >
            <Label :for="inputId"
              >Type <span class="font-mono">{{ env }}</span> to delete
              there</Label
            >
            <Input
              :id="inputId"
              v-model="typed"
              autocomplete="off"
              autocapitalize="off"
              spellcheck="false"
            />
          </div>
        </template>
      </div>

      <DialogFooter>
        <DialogClose as-child>
          <Button variant="ghost">Close</Button>
        </DialogClose>
        <Button
          v-if="(phase === 'found' || phase === 'deleting') && count > 0"
          variant="destructive"
          :disabled="!canDelete"
          @click="remove"
        >
          <Trash2Icon aria-hidden="true" />
          {{
            phase === "deleting"
              ? "Deleting…"
              : `Delete ${plural(count, "record", "records")}`
          }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
