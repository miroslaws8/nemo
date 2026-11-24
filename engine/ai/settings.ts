import { loadE2eConfig } from "../config";
import type { IAiModelSettings, IAiSettings, IE2eConfig } from "../types";

/**
 * The AI settings of a run, or null when AI is off: no `ai` section, or `ai: false` on the
 * environment or the profile (either one is enough, e.g. prod's smoke monitor).
 */
export function resolveAiSettingsFrom(
  config: IE2eConfig,
  environmentName: string,
  profileName: string
): IAiSettings | null {
  const section = config.ai;
  if (
    section === undefined ||
    config.environments[environmentName]?.ai === false ||
    config.profiles[profileName]?.ai === false
  ) {
    return null;
  }
  const models: Record<string, IAiModelSettings> = {};
  for (const [role, model] of Object.entries(section.models)) {
    models[role] = {
      protocol: model.protocol,
      model: model.model,
      baseUrl: model.base_url ?? null,
      keyVariable: model.key,
      vision: model.vision,
      usdPerMillion: { ...model.usd_per_million },
      params: { ...model.params },
    };
  }
  return {
    models,
    judge: {
      model: section.judge.model,
      escalateTo: section.judge.escalate_to ?? null,
      minConfidence: section.judge.min_confidence,
      retries: section.judge.retries,
      blocking: section.judge.blocking,
    },
    budgetUsdPerRun: section.budget_usd_per_run,
    author:
      section.author === undefined
        ? null
        : {
            model: section.author.model,
            maxActions: section.author.max_actions,
            avoid: [...section.author.avoid],
          },
  };
}

/** The same for this process's e2e.config.yaml. */
export function resolveAiSettings(
  environmentName: string,
  profileName: string
): IAiSettings | null {
  return resolveAiSettingsFrom(loadE2eConfig(), environmentName, profileName);
}
