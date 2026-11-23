import { catalogSchema } from "@shared/api";
import type { ICatalogTest, IRunSource } from "@shared/types";
import type { MaybeRefOrGetter, Ref } from "vue";
import { ref, toValue, watch } from "vue";
import { getJson, messageOf } from "@/lib/api";

// The tests one environment × profile can run, from a branch on a server console (the server lists
// them with Playwright, which takes a few seconds, and keeps the listing). Loads only while
// `enabled`; `source` is the commit the listing came from.

export function useCatalog(
  environment: MaybeRefOrGetter<string>,
  profile: MaybeRefOrGetter<string>,
  // The branch to list (a server console); null: the environment's own, or the working tree.
  branch: MaybeRefOrGetter<string | null>,
  enabled: MaybeRefOrGetter<boolean>
): {
  tests: Ref<ICatalogTest[]>;
  source: Ref<IRunSource | null>;
  loading: Ref<boolean>;
  error: Ref<string | null>;
  reload: () => Promise<void>;
} {
  const tests = ref<ICatalogTest[]>([]);
  const source = ref<IRunSource | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  // Only the newest request may change the state.
  let latest = 0;
  let loadedKey = "";

  async function load(refresh: boolean): Promise<void> {
    const environmentName = toValue(environment);
    const profileName = toValue(profile);
    const branchName = toValue(branch);
    const key = `${environmentName}|${profileName}|${branchName ?? ""}`;
    if (
      !toValue(enabled) ||
      environmentName === "" ||
      profileName === "" ||
      (key === loadedKey && !refresh)
    ) {
      return;
    }
    latest += 1;
    const request = latest;
    loading.value = true;
    error.value = null;
    const query = new URLSearchParams({
      env: environmentName,
      profile: profileName,
    });
    if (branchName !== null) {
      query.set("ref", branchName);
    }
    if (refresh) {
      query.set("refresh", "1");
    }
    try {
      const listed = await getJson(`/api/catalog?${query}`, catalogSchema);
      if (request === latest) {
        tests.value = listed.tests;
        source.value = listed.source;
        loadedKey = key;
      }
    } catch (failure) {
      if (request === latest) {
        tests.value = [];
        source.value = null;
        loadedKey = "";
        error.value = messageOf(failure);
      }
    } finally {
      if (request === latest) {
        loading.value = false;
      }
    }
  }

  watch(
    [
      () => toValue(environment),
      () => toValue(profile),
      () => toValue(branch),
      () => toValue(enabled),
    ],
    () => load(false),
    { immediate: true }
  );

  return { tests, source, loading, error, reload: () => load(true) };
}
