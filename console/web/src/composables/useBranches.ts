import { branchListSchema } from "@shared/api";
import type { IBranch } from "@shared/types";
import type { MaybeRefOrGetter, Ref } from "vue";
import { ref, toValue, watch } from "vue";
import { getJson, messageOf } from "@/lib/api";

// The branches a server console can test, newest commit first; asked for each time `enabled`
// turns on (the New run dialog opens), so a branch pushed a moment ago shows up.

export function useBranches(enabled: MaybeRefOrGetter<boolean>): {
  branches: Ref<IBranch[]>;
  loading: Ref<boolean>;
  error: Ref<string | null>;
} {
  const branches = ref<IBranch[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  watch(
    () => toValue(enabled),
    async (isEnabled) => {
      if (!isEnabled) {
        return;
      }
      loading.value = true;
      error.value = null;
      try {
        branches.value = await getJson("/api/branches", branchListSchema);
      } catch (failure) {
        error.value = messageOf(failure);
      } finally {
        loading.value = false;
      }
    },
    { immediate: true }
  );

  return { branches, loading, error };
}
