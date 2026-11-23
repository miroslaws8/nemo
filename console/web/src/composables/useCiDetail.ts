import { ciDetailSchema } from "@shared/api";
import type { ICiDetail, ICiStatus } from "@shared/types";
import type { MaybeRefOrGetter, Ref } from "vue";
import { onScopeDispose, ref, toValue, watch } from "vue";
import { getJson, messageOf } from "@/lib/api";

// A CI pipeline's steps and test reports: read again every 10 s while it goes (the console asks
// Bitbucket at most every 20 s) and once more when its status changes.

const POLL_MS = 10_000;

export function useCiDetail(
  number: MaybeRefOrGetter<number>,
  status: MaybeRefOrGetter<ICiStatus | null>,
  going: MaybeRefOrGetter<boolean>
): { detail: Ref<ICiDetail | null>; error: Ref<string | null> } {
  const detail = ref<ICiDetail | null>(null);
  const error = ref<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let latest = 0;

  function cancel(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  async function load(): Promise<void> {
    cancel();
    latest += 1;
    const request = latest;
    try {
      const loaded = await getJson(
        `/api/ci/pipelines/${toValue(number)}`,
        ciDetailSchema
      );
      if (request === latest) {
        detail.value = loaded;
        error.value = null;
      }
    } catch (failure) {
      if (request === latest) {
        error.value = messageOf(failure);
      }
    }
    if (request === latest && toValue(going)) {
      timer = setTimeout(() => void load(), POLL_MS);
    }
  }

  watch(
    () => toValue(number),
    () => {
      detail.value = null;
      error.value = null;
      void load();
    },
    { immediate: true }
  );
  watch(
    () => toValue(status),
    (now, before) => {
      if (before !== undefined && now !== before) {
        void load();
      }
    }
  );

  onScopeDispose(() => {
    latest += 1;
    cancel();
  });

  return { detail, error };
}
