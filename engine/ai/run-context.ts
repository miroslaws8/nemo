import { selectedProfileName } from "../run-selection";
import type { IAiRunContext, IEnvironment } from "../types";
import { createModelClient } from "./client";
import { resolveAiSettings } from "./settings";
import { runSpend } from "./spend";

/** The run's AI, once per worker: the judge's models, sharing the run's budget; null when off. */
export function aiRunContext(environment: IEnvironment): IAiRunContext | null {
  const settings = resolveAiSettings(environment.name, selectedProfileName());
  if (settings === null) {
    return null;
  }
  const spend = runSpend();
  const escalateTo = settings.judge.escalateTo;
  return {
    settings,
    primary: createModelClient(settings, settings.judge.model, spend),
    escalation:
      escalateTo === null
        ? null
        : createModelClient(settings, escalateTo, spend),
  };
}
