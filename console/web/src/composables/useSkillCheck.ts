import { skillCheckSchema } from "@shared/api";
import type { ISkillCheck, ISkillCheckRequest } from "@shared/types";
import { refDebounced } from "@vueuse/core";
import type { Ref } from "vue";
import { computed, ref, watch } from "vue";
import { messageOf, postJson } from "@/lib/api";

// A skill.yaml checked by the console as the person types or drops a file: at each pause of
// PAUSE_MS, and only the newest answer counts. `stale` says the answer is for an older text.

const PAUSE_MS = 400;

export function useSkillCheck(request: () => ISkillCheckRequest | null): {
  result: Ref<ISkillCheck | null>;
  checking: Ref<boolean>;
  error: Ref<string | null>;
  stale: Ref<boolean>;
  recheck: () => Promise<void>;
} {
  const result = ref<ISkillCheck | null>(null);
  const checking = ref(false);
  const error = ref<string | null>(null);
  // The request the result answers.
  const answered = ref("");
  const asked = computed(() => {
    const current = request();
    return current === null ? "" : JSON.stringify(current);
  });
  const settled = refDebounced(asked, PAUSE_MS);
  let latest = 0;

  async function check(): Promise<void> {
    const current = request();
    latest += 1;
    const mine = latest;
    if (current === null) {
      result.value = null;
      error.value = null;
      answered.value = "";
      checking.value = false;
      return;
    }
    checking.value = true;
    try {
      const answer = await postJson(
        "/api/skills/check",
        current,
        skillCheckSchema
      );
      if (mine === latest) {
        result.value = answer;
        error.value = null;
        answered.value = JSON.stringify(current);
      }
    } catch (failure) {
      if (mine === latest) {
        error.value = messageOf(failure);
      }
    } finally {
      if (mine === latest) {
        checking.value = false;
      }
    }
  }

  watch(settled, () => check(), { immediate: true });
  return {
    result,
    checking,
    error,
    stale: computed(() => asked.value !== answered.value),
    recheck: check,
  };
}
