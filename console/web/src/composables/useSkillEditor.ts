import { skillDetailSchema } from "@shared/api";
import type {
  IConsoleMode,
  ISkillCheck,
  ISkillDetail,
  ISkillOrigin,
  ISkillProblem,
} from "@shared/types";
import { useEventListener } from "@vueuse/core";
import type { ComputedRef, Ref } from "vue";
import { computed, ref } from "vue";
import { onBeforeRouteLeave, useRouter } from "vue-router";
import { toast } from "vue-sonner";
import { useSkillCheck } from "@/composables/useSkillCheck";
import { useSkillDetail } from "@/composables/useSkills";
import { messageOf, postJson } from "@/lib/api";
import { plural } from "@/lib/format";
import { skillPath } from "@/lib/paths";
import { mayEditSkills } from "@/state/access";
import { openNewRun } from "@/state/dialogs";
import { storeWords } from "@/state/config";
import { me } from "@/state/session";
import type { IPermission, ITone } from "@/types";

// What every way of making a skill shares once there is a skill.yaml (a file, pasted text, a
// form): the console's check at every pause, where it stands, the button and what it does, the
// one-click save (a toast offers to try it), and the question before leaving unsaved work.

// The skill a new version replaces: the working tree's (a local console), or the console's own.
const REPLACED: Record<IConsoleMode, ISkillOrigin | null> = {
  local: null,
  server: "console",
};

export interface ISkillEditorOptions {
  // The skill a new version replaces; null: a new skill.
  replacing: () => string | null;
  // The new skill's name (a new version keeps its own).
  name: () => string;
  // The skill.yaml to check and keep ("": nothing yet).
  yaml: () => string;
  // Whether leaving now would lose work (the file, or edits to a template).
  unsaved: () => boolean;
}

export interface ISkillEditor {
  editing: ComputedRef<IPermission>;
  replacedOrigin: ComputedRef<ISkillOrigin | null>;
  current: Ref<ISkillDetail | null>;
  currentError: Ref<string | null>;
  result: Ref<ISkillCheck | null>;
  problems: ComputedRef<ISkillProblem[]>;
  status: ComputedRef<{ tone: ITone; words: string } | null>;
  canSave: ComputedRef<boolean>;
  saveLabel: ComputedRef<string>;
  happens: ComputedRef<string>;
  save: () => Promise<void>;
}

export function useSkillEditor(options: ISkillEditorOptions): ISkillEditor {
  const router = useRouter();
  const editing = computed(() => mayEditSkills());
  const replacedOrigin = computed(() => REPLACED[me.value?.mode ?? "local"]);
  const replacing = computed(() => options.replacing() !== null);
  const saving = ref(false);
  const saved = ref(false);

  const { detail: current, error: currentError } = useSkillDetail(
    () => options.replacing(),
    () => replacedOrigin.value,
    () => null
  );

  const {
    result,
    checking,
    error: checkError,
    stale,
    recheck,
  } = useSkillCheck(() =>
    editing.value.allowed && options.yaml().trim() !== ""
      ? {
          name: (options.replacing() ?? options.name()).trim(),
          yaml: options.yaml(),
          replacing: replacing.value,
        }
      : null
  );

  const problems = computed(() => result.value?.problems ?? []);
  const errors = computed(() =>
    problems.value.filter((found) => found.severity === "error")
  );
  const warnings = computed(() =>
    problems.value.filter((found) => found.severity === "warning")
  );

  // A new version replaces a skill only where this console keeps it (not a repo skill on a server).
  const replaceable = computed(
    () =>
      !replacing.value ||
      (current.value !== null && current.value.hash !== null)
  );
  const nextVersion = computed(() => {
    const version = current.value?.skill.version ?? null;
    return version === null ? null : version + 1;
  });

  // The check takes a skill with no name yet; adding it needs one.
  const named = computed(
    () => (options.replacing() ?? options.name()).trim() !== ""
  );

  const status = computed((): { tone: ITone; words: string } | null => {
    if (options.yaml().trim() === "") {
      return null;
    }
    if (checkError.value !== null) {
      return { tone: "fail", words: checkError.value };
    }
    if (checking.value || stale.value || result.value === null) {
      return { tone: "run", words: "Checking…" };
    }
    const warned =
      warnings.value.length === 0
        ? ""
        : ` · ${plural(warnings.value.length, "warning", "warnings")}`;
    if (errors.value.length > 0) {
      return {
        tone: "fail",
        words: `${plural(
          errors.value.length,
          "problem",
          "problems"
        )} to fix${warned}`,
      };
    }
    if (!named.value) {
      return { tone: "idle", words: `Give it a name to add it${warned}` };
    }
    return {
      tone: "pass",
      words: `${replacing.value ? "Ready to save" : "Ready to add"}${warned}`,
    };
  });

  const canSave = computed(
    () =>
      editing.value.allowed &&
      replaceable.value &&
      named.value &&
      !saving.value &&
      options.yaml().trim() !== "" &&
      !checking.value &&
      !stale.value &&
      checkError.value === null &&
      result.value !== null &&
      errors.value.length === 0
  );

  const saveLabel = computed(() => {
    if (saving.value) {
      return replacing.value ? "Saving…" : "Adding…";
    }
    if (!replacing.value) {
      return "Add skill";
    }
    return nextVersion.value === null
      ? "Save"
      : `Save as v${nextVersion.value}`;
  });

  // What the click does, in the console's words for its mode.
  const happens = computed(() =>
    (replacing.value
      ? storeWords.value.replaceSkill
      : storeWords.value.addSkill
    )
      .replace(
        "{name}",
        (options.replacing() ?? options.name()).trim() || "<name>"
      )
      .replace("{version}", String(nextVersion.value ?? 1))
  );

  async function save(): Promise<void> {
    if (!canSave.value) {
      return;
    }
    const replaced = options.replacing();
    const name = (replaced ?? options.name()).trim();
    saving.value = true;
    try {
      const detail =
        replaced === null
          ? await postJson(
              "/api/skills",
              { name, yaml: options.yaml() },
              skillDetailSchema
            )
          : await postJson(
              `/api/skills/${encodeURIComponent(name)}/versions`,
              { yaml: options.yaml(), basedOn: current.value?.hash ?? "" },
              skillDetailSchema
            );
      saved.value = true;
      toast.success(
        replaced === null
          ? `${name} added`
          : detail.skill.version === null
          ? `${name} saved`
          : `${name} is now v${detail.skill.version}`,
        {
          description: "It is ready to run.",
          action: {
            label: "Try it",
            onClick: () => openNewRun(null, { skill: name, branch: null }),
          },
        }
      );
      await router.push(
        skillPath(name, detail.skill.shadowed ? "console" : null)
      );
    } catch (failure) {
      toast.error(messageOf(failure));
      void recheck();
    } finally {
      saving.value = false;
    }
  }

  const leaving = (): boolean => !saved.value && options.unsaved();
  onBeforeRouteLeave(() =>
    leaving()
      ? window.confirm("Leave without saving? What you have here is not kept.")
      : true
  );
  useEventListener(window, "beforeunload", (event: BeforeUnloadEvent) => {
    if (leaving()) {
      event.preventDefault();
    }
  });

  return {
    editing,
    replacedOrigin,
    current,
    currentError,
    result,
    problems,
    status,
    canSave,
    saveLabel,
    happens,
    save,
  };
}
