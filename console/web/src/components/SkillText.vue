<script setup lang="ts">
import { computed } from "vue";

// A skill's Markdown as text: its paragraphs, its ``` code blocks as code, `code` and **bold**
// inside the paragraphs. Nothing of it becomes HTML (no v-html): it is shown, never run.

const props = defineProps<{ text: string }>();

interface IPiece {
  kind: "text" | "code" | "strong";
  text: string;
}

interface IBlock {
  kind: "paragraph" | "code";
  text: string;
  pieces: IPiece[];
}

const INLINE = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/;

function piecesOf(text: string): IPiece[] {
  return text
    .split(INLINE)
    .filter((part) => part !== "")
    .map((part): IPiece => {
      if (part.startsWith("`") && part.endsWith("`") && part.length > 1) {
        return { kind: "code", text: part.slice(1, -1) };
      }
      if (part.startsWith("**") && part.endsWith("**") && part.length > 3) {
        return { kind: "strong", text: part.slice(2, -2) };
      }
      return { kind: "text", text: part };
    });
}

const blocks = computed((): IBlock[] => {
  const found: IBlock[] = [];
  let lines: string[] = [];
  let inCode = false;
  const flush = (kind: IBlock["kind"]): void => {
    const text = lines.join("\n");
    if (kind === "code" || text.trim() !== "") {
      found.push({
        kind,
        text,
        pieces: kind === "code" ? [] : piecesOf(text.trim()),
      });
    }
    lines = [];
  };
  for (const line of props.text.split("\n")) {
    if (line.trimStart().startsWith("```")) {
      flush(inCode ? "code" : "paragraph");
      inCode = !inCode;
      continue;
    }
    lines.push(line);
  }
  flush(inCode ? "code" : "paragraph");
  return found;
});
</script>

<template>
  <div class="min-w-0 space-y-2">
    <template v-for="(block, index) in blocks" :key="index">
      <pre
        v-if="block.kind === 'code'"
        class="overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs leading-5"
        >{{ block.text }}</pre
      >
      <p v-else class="whitespace-pre-line">
        <template v-for="(piece, at) in block.pieces" :key="at">
          <code
            v-if="piece.kind === 'code'"
            class="rounded-sm bg-muted px-1 py-px font-mono text-[0.85em]"
            >{{ piece.text }}</code
          >
          <strong v-else-if="piece.kind === 'strong'" class="font-semibold">{{
            piece.text
          }}</strong>
          <template v-else>{{ piece.text }}</template>
        </template>
      </p>
    </template>
  </div>
</template>
