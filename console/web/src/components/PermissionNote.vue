<script setup lang="ts">
import { LockIcon } from "@lucide/vue";
import { cn } from "cn";
import type { HTMLAttributes } from "vue";
import type { IPermission } from "@/types";

// Why the buttons next to it are greyed out (the role it takes, and the one this person has): a
// one-line banner, the lock on its left. A class given to it wins over its own.

const props = defineProps<{
  permission: IPermission;
  class?: HTMLAttributes["class"];
}>();
</script>

<template>
  <p
    v-if="!permission.allowed && permission.reason !== null"
    :class="
      cn(
        'flex items-start gap-2 rounded-md bg-idle/10 px-3 py-2 text-sm text-muted-foreground',
        props.class
      )
    "
  >
    <LockIcon class="mt-[3px] size-3.5 shrink-0" aria-hidden="true" />
    <span class="min-w-0">{{ permission.reason }}</span>
  </p>
</template>
