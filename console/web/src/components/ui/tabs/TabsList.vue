<script setup lang="ts">
import type { TabsListProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { reactiveOmit } from "@vueuse/core";
import { cn } from "cn";
import { TabsList } from "reka-ui";

const props = defineProps<
  TabsListProps & { class?: HTMLAttributes["class"] }
>();

const delegatedProps = reactiveOmit(props, "class");
</script>

<template>
  <TabsList
    data-slot="tabs-list"
    v-bind="delegatedProps"
    :class="
      cn(
        'text-muted-foreground inline-flex h-9 w-fit items-center justify-start gap-4 border-b bg-transparent p-0',
        props.class
      )
    "
  >
    <slot />
  </TabsList>
</template>
