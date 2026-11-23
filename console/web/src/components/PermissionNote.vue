<script setup lang="ts">
import { LockIcon } from "@lucide/vue";
import type { IPermission } from "@/types";

// Why the buttons next to it are greyed out: the role it takes, and the one this person has.

defineProps<{ permission: IPermission }>();
</script>

<template>
  <p
    v-if="!permission.allowed && permission.reason !== null"
    class="flex items-start gap-1.5 text-sm text-muted-foreground"
  >
    <LockIcon class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
    {{ permission.reason }}
  </p>
</template>
