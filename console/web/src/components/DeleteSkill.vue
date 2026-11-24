<script setup lang="ts">
import { skillDeletedSchema } from "@shared/api";
import type { ISkillStoreKind } from "@shared/types";
import { Trash2Icon } from "@lucide/vue";
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { toast } from "vue-sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { messageOf, postJson } from "@/lib/api";
import { deleteSkillUrl, skillsPath } from "@/lib/paths";
import type { IPermission } from "@/types";

// Deletes a skill from where this console keeps them, after a question that says what goes: from
// the skill store for every console, from this console, or (a working copy) its folder git does
// not keep. Runs that used it keep their reports; CI's checks of it fail until it is back. Its
// trigger is the title bar's icon button (its reason, or what it does, as a tooltip).

const props = defineProps<{
  name: string;
  store: ISkillStoreKind;
  versions: number;
  promoted: boolean;
  // The environments CI runs it on after a deploy (agent_checks).
  afterDeploys: string[];
  permission: IPermission;
}>();

defineOptions({ inheritAttrs: false });

// Open from outside too: below `md` the page's "⋯" menu asks for it (its trigger is hidden there).
const open = defineModel<boolean>("open", { default: false });
const router = useRouter();
const busy = ref(false);

const WHAT_GOES: Record<ISkillStoreKind, (count: string) => string> = {
  registry: (count) =>
    `It leaves the skill store for every console, with ${count}`,
  console: (count) => `It leaves this console, with ${count}`,
  "working-tree": () =>
    "Its folder hermes/skills goes from this working copy (git does not keep it)",
};

const whatGoes = computed(() =>
  WHAT_GOES[props.store](
    `${props.versions} version${props.versions === 1 ? "" : "s"}${
      props.promoted ? " and the one prod runs" : ""
    }`
  )
);

async function remove(): Promise<void> {
  busy.value = true;
  try {
    await postJson(deleteSkillUrl(props.name), {}, skillDeletedSchema);
    toast.success(`Deleted ${props.name}`);
    await router.push(skillsPath());
  } catch (error) {
    toast.error(`${props.name} is not deleted: ${messageOf(error)}`);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AlertDialog v-model:open="open">
    <Tooltip>
      <TooltipTrigger as-child>
        <!-- The span takes the pointer while the button is disabled, so the reason still shows. -->
        <span
          class="inline-flex"
          :tabindex="permission.allowed ? undefined : 0"
          v-bind="$attrs"
        >
          <AlertDialogTrigger as-child>
            <Button
              variant="outline"
              size="icon-sm"
              class="text-fail"
              :disabled="!permission.allowed || busy"
            >
              <Trash2Icon aria-hidden="true" />
              <span class="sr-only">Delete…</span>
            </Button>
          </AlertDialogTrigger>
        </span>
      </TooltipTrigger>
      <TooltipContent>{{ permission.reason ?? "Delete…" }}</TooltipContent>
    </Tooltip>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Delete {{ name }}?</AlertDialogTitle>
        <AlertDialogDescription class="space-y-2">
          <span class="block">
            {{ whatGoes }}. Runs that used it keep their reports; Run again of
            them fails.
          </span>
          <span v-if="afterDeploys.length > 0" class="block text-fail">
            CI runs it after deploys on {{ afterDeploys.join(" and ") }}
            (agent_checks): those checks fail until it is back or off the list.
          </span>
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Keep it</AlertDialogCancel>
        <AlertDialogAction
          class="bg-destructive text-white hover:bg-destructive/90"
          @click="remove()"
        >
          Delete {{ name }}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
