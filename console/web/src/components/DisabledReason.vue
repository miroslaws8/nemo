<script setup lang="ts">
import { useId } from "vue";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// A control that may be greyed out, and why: the reason shows as a tooltip on hover and on keyboard
// focus, and is the control's description (`describedBy`, for the control's aria-describedby) for
// screen readers. A disabled button takes neither the pointer nor the focus, so this wrapper does
// while it is greyed out. `hint` is the tooltip while it is not (an icon button's name); classes
// given to it go to the wrapper.

const props = defineProps<{
  // Why the control is greyed out; null: it is not.
  reason: string | null;
  hint?: string;
  side?: "top" | "right" | "bottom" | "left";
}>();

defineOptions({ inheritAttrs: false });

const reasonId = useId();
</script>

<template>
  <Tooltip :disabled="props.reason === null && props.hint === undefined">
    <TooltipTrigger as-child>
      <span
        class="inline-flex"
        :tabindex="props.reason === null ? undefined : 0"
        v-bind="$attrs"
      >
        <slot
          v-bind="{
            describedBy: props.reason === null ? undefined : reasonId,
          }"
        />
      </span>
    </TooltipTrigger>
    <TooltipContent :side="props.side">{{
      props.reason ?? props.hint
    }}</TooltipContent>
  </Tooltip>
  <span v-if="props.reason !== null" :id="reasonId" class="sr-only">{{
    props.reason
  }}</span>
</template>
