<script setup lang="ts">
import { skillDetailSchema } from "@shared/api";
import { RocketIcon } from "@lucide/vue";
import { ref } from "vue";
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
import { messageOf, postJson } from "@/lib/api";
import { promoteSkillUrl } from "@/lib/paths";
import type { IPermission } from "@/types";

// Makes one version of a stored skill the one prod runs (its skill_channel), after a question:
// prod's checks, CI's after a deploy among them, run it from the next one on.

const props = defineProps<{
  name: string;
  version: number;
  // The version prod runs now; null: none yet.
  prodVersion: number | null;
  permission: IPermission;
}>();
const emit = defineEmits<{ promoted: [] }>();

const open = ref(false);
const busy = ref(false);

async function promote(): Promise<void> {
  busy.value = true;
  try {
    await postJson(
      promoteSkillUrl(props.name),
      { version: props.version },
      skillDetailSchema
    );
    toast.success(`Prod runs ${props.name} v${props.version} now`);
    emit("promoted");
  } catch (error) {
    toast.error(`v${props.version} is not on prod: ${messageOf(error)}`);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <span :title="permission.reason ?? undefined">
    <AlertDialog v-model:open="open">
      <AlertDialogTrigger as-child>
        <Button
          variant="outline"
          size="sm"
          :disabled="!permission.allowed || busy"
        >
          <RocketIcon aria-hidden="true" />
          Promote to prod
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Run v{{ version }} on prod?</AlertDialogTitle>
          <AlertDialogDescription>
            Prod's checks of {{ name }} run v{{ version }} from the next one on,
            CI's after a deploy among them<template v-if="prodVersion !== null">
              (now they run v{{ prodVersion }}: promote it again to go
              back)</template
            >. Staging and local keep running the newest version.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction @click="promote()">
            Promote v{{ version }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </span>
</template>
