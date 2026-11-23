import { logChunkSchema } from "@shared/api";
import type { MaybeRefOrGetter, Ref } from "vue";
import { onScopeDispose, ref, toValue, watch } from "vue";
import { getJson, messageOf } from "@/lib/api";

// A log read on from where the last read ended (`url` answers ?offset= with whole lines): every
// 1.5 s while its run or step goes, and straight to the end once it is over. Keeps MAX_CHARS.

const POLL_MS = 1500;
const MAX_CHARS = 500_000;

export function useLogTail(
  url: MaybeRefOrGetter<string>,
  going: MaybeRefOrGetter<boolean>,
  enabled: MaybeRefOrGetter<boolean>
): {
  text: Ref<string>;
  trimmed: Ref<boolean>;
  error: Ref<string | null>;
} {
  const text = ref("");
  const trimmed = ref(false);
  const error = ref<string | null>(null);
  let offset = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let busy = false;
  let again = false;
  // Bumped when the log changes, so a read of the previous one is thrown away.
  let generation = 0;

  function cancelTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function append(chunk: string): void {
    const joined = text.value + chunk;
    if (joined.length > MAX_CHARS) {
      trimmed.value = true;
      text.value = joined.slice(joined.length - MAX_CHARS);
      return;
    }
    text.value = joined;
  }

  async function pull(): Promise<void> {
    busy = true;
    const ownGeneration = generation;
    let grew = false;
    try {
      const chunk = await getJson(
        `${toValue(url)}?offset=${offset}`,
        logChunkSchema
      );
      if (ownGeneration === generation) {
        grew = chunk.offset > offset;
        offset = chunk.offset;
        append(chunk.text);
        error.value = null;
      }
    } catch (failure) {
      if (ownGeneration === generation) {
        error.value = messageOf(failure);
      }
    } finally {
      busy = false;
    }
    if (again || ownGeneration !== generation) {
      again = false;
      kick();
      return;
    }
    if (toValue(enabled) && (toValue(going) || grew)) {
      timer = setTimeout(
        () => {
          timer = null;
          void pull();
        },
        grew && !toValue(going) ? 0 : POLL_MS
      );
    }
  }

  // Reads now, or right after the read in progress.
  function kick(): void {
    cancelTimer();
    if (!toValue(enabled)) {
      return;
    }
    if (busy) {
      again = true;
      return;
    }
    void pull();
  }

  watch(
    () => toValue(url),
    () => {
      generation += 1;
      offset = 0;
      text.value = "";
      trimmed.value = false;
      error.value = null;
      kick();
    }
  );
  watch([() => toValue(enabled), () => toValue(going)], kick, {
    immediate: true,
  });

  onScopeDispose(() => {
    generation += 1;
    cancelTimer();
  });

  return { text, trimmed, error };
}
