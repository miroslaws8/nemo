<script setup lang="ts">
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, XIcon } from "@lucide/vue";
import { nextTick } from "vue";
import { fieldId } from "@/lib/skill-draft";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

// A list of texts in a skill's form (its steps, its report, when it fails): each item its own
// field, added, taken out or moved; the console's problems with an item stand under it.

const props = defineProps<{
  label: string;
  // What one item is called ("Step"): the buttons and the items' labels say it.
  itemLabel: string;
  addLabel: string;
  // The field's path in the skill.yaml (problems and focus find its items by it).
  path: (string | number)[];
  errorsAt: (path: (string | number)[]) => string[];
  ordered?: boolean;
  placeholder?: string;
  hint?: string;
}>();
const items = defineModel<string[]>({ required: true });

function setItem(index: number, value: string | number): void {
  items.value = items.value.map((item, at) =>
    at === index ? String(value) : item
  );
}

async function add(): Promise<void> {
  items.value = [...items.value, ""];
  await nextTick();
  document
    .getElementById(fieldId([...props.path, items.value.length - 1]))
    ?.focus();
}

function remove(index: number): void {
  items.value = items.value.filter((_item, at) => at !== index);
}

function move(index: number, by: number): void {
  const target = index + by;
  if (target < 0 || target >= items.value.length) {
    return;
  }
  const next = [...items.value];
  const [moved] = next.splice(index, 1);
  if (moved !== undefined) {
    next.splice(target, 0, moved);
  }
  items.value = next;
}
</script>

<template>
  <fieldset
    :id="fieldId(path)"
    class="grid min-w-0 grid-cols-1 gap-2"
    tabindex="-1"
  >
    <legend class="text-sm font-medium">{{ label }}</legend>
    <p v-if="hint !== undefined" class="-mt-1 text-xs text-muted-foreground">
      {{ hint }}
    </p>
    <p
      v-for="(message, index) in errorsAt(path)"
      :key="`list-${index}`"
      class="text-xs text-fail"
    >
      {{ message }}
    </p>
    <component :is="ordered ? 'ol' : 'ul'" class="grid grid-cols-1 gap-2">
      <li
        v-for="(item, index) in items"
        :key="index"
        class="flex items-start gap-2"
      >
        <span
          v-if="ordered"
          class="mt-2 w-6 shrink-0 text-right text-sm tabular-nums text-muted-foreground"
          aria-hidden="true"
          >{{ index + 1 }}.</span
        >
        <div class="min-w-0 flex-1">
          <Textarea
            :id="fieldId([...path, index])"
            :model-value="item"
            :aria-label="`${itemLabel} ${index + 1}`"
            :aria-invalid="errorsAt([...path, index]).length > 0"
            :placeholder="placeholder"
            class="min-h-9 py-1.5 text-sm"
            rows="1"
            @update:model-value="(value) => setItem(index, value)"
          />
          <p
            v-for="(message, at) in errorsAt([...path, index])"
            :key="at"
            class="mt-1 text-xs text-fail"
          >
            {{ message }}
          </p>
        </div>
        <div class="flex shrink-0 items-center">
          <Button
            variant="ghost"
            size="icon-sm"
            :disabled="index === 0"
            :aria-label="`Move ${itemLabel.toLowerCase()} ${index + 1} up`"
            @click="move(index, -1)"
          >
            <ArrowUpIcon aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            :disabled="index === items.length - 1"
            :aria-label="`Move ${itemLabel.toLowerCase()} ${index + 1} down`"
            @click="move(index, 1)"
          >
            <ArrowDownIcon aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            :aria-label="`Remove ${itemLabel.toLowerCase()} ${index + 1}`"
            @click="remove(index)"
          >
            <XIcon aria-hidden="true" />
          </Button>
        </div>
      </li>
    </component>
    <Button
      variant="outline"
      size="sm"
      class="justify-self-start"
      @click="add()"
    >
      <PlusIcon aria-hidden="true" />
      {{ addLabel }}
    </Button>
  </fieldset>
</template>
