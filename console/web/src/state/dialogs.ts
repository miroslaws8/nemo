import { ref } from "vue";

// Dialogs more than one place opens.

/** An agent check the next "New run" dialog starts as: a skill, on a branch (null: the environment's). */
export interface INewRunPreset {
  skill: string;
  branch: string | null;
}

export const newRunOpen = ref(false);
// A skill written by AI from a description, for the skill's form to open on (taken once).
export const skillStart = ref<{ name: string; yaml: string } | null>(null);
/** The environment the next "New run" dialog starts on (null: its own default). */
export const newRunEnvironment = ref<string | null>(null);
export const newRunPreset = ref<INewRunPreset | null>(null);

export function openNewRun(
  environment: string | null = null,
  preset: INewRunPreset | null = null
): void {
  newRunEnvironment.value = environment;
  newRunPreset.value = preset;
  newRunOpen.value = true;
}

/** The sidebar as a sheet, below `md` (the page bar's menu button opens it). */
export const navOpen = ref(false);
