import {
  skillDetailSchema,
  skillListSchema,
  skillTemplateListSchema,
} from "@shared/api";
import type {
  ISkillDetail,
  ISkillList,
  ISkillOrigin,
  ISkillTemplateList,
} from "@shared/types";
import type { MaybeRefOrGetter, Ref } from "vue";
import { ref, toValue, watch } from "vue";
import { getJson, messageOf } from "@/lib/api";

// The Skills page's list (a branch's repo skills and the console's), and one skill's detail. Each
// loads when what it is about changes (a null path: nothing to load); only the newest answer counts.

function useLoad<TValue>(
  path: () => string | null,
  read: (url: string) => Promise<TValue>
): {
  value: Ref<TValue | null>;
  loading: Ref<boolean>;
  error: Ref<string | null>;
  reload: () => Promise<void>;
} {
  const value = ref<TValue | null>(null) as Ref<TValue | null>;
  const loading = ref(false);
  const error = ref<string | null>(null);
  let latest = 0;

  async function load(): Promise<void> {
    latest += 1;
    const request = latest;
    const url = path();
    if (url === null) {
      value.value = null;
      loading.value = false;
      error.value = null;
      return;
    }
    loading.value = true;
    error.value = null;
    try {
      const answer = await read(url);
      if (request === latest) {
        value.value = answer;
      }
    } catch (failure) {
      if (request === latest) {
        error.value = messageOf(failure);
      }
    } finally {
      if (request === latest) {
        loading.value = false;
      }
    }
  }

  watch(path, () => load(), { immediate: true });
  return { value, loading, error, reload: load };
}

export function useSkillList(branch: MaybeRefOrGetter<string | null>): {
  list: Ref<ISkillList | null>;
  loading: Ref<boolean>;
  error: Ref<string | null>;
  reload: () => Promise<void>;
} {
  const { value, ...rest } = useLoad(
    () => {
      const branchName = toValue(branch);
      return branchName === null
        ? "/api/skills"
        : `/api/skills?${new URLSearchParams({ ref: branchName })}`;
    },
    (url) => getJson(url, skillListSchema)
  );
  return { list: value, ...rest };
}

export function useSkillDetail(
  // null: no skill to load (yet).
  name: MaybeRefOrGetter<string | null>,
  origin: MaybeRefOrGetter<ISkillOrigin | null>,
  branch: MaybeRefOrGetter<string | null>
): {
  detail: Ref<ISkillDetail | null>;
  loading: Ref<boolean>;
  error: Ref<string | null>;
  reload: () => Promise<void>;
} {
  const { value, ...rest } = useLoad(
    () => {
      const skillName = toValue(name);
      if (skillName === null) {
        return null;
      }
      const query = new URLSearchParams();
      const chosenOrigin = toValue(origin);
      const branchName = toValue(branch);
      if (chosenOrigin !== null) {
        query.set("origin", chosenOrigin);
      }
      if (branchName !== null) {
        query.set("ref", branchName);
      }
      const search = query.toString();
      return `/api/skills/${encodeURIComponent(skillName)}${
        search === "" ? "" : `?${search}`
      }`;
    },
    (url) => getJson(url, skillDetailSchema)
  );
  return { detail: value, ...rest };
}

/** The templates a new skill can start from (hermes/skill-templates). */
export function useSkillTemplates(): {
  templates: Ref<ISkillTemplateList | null>;
  loading: Ref<boolean>;
  error: Ref<string | null>;
  reload: () => Promise<void>;
} {
  const { value, ...rest } = useLoad(
    () => "/api/skills/templates",
    (url) => getJson(url, skillTemplateListSchema)
  );
  return { templates: value, ...rest };
}
