import { loadE2eConfig } from "./config";
import { buildEnvironment, selectedEnvironmentName } from "./environment";
import { parseDuration } from "./schema";
import type { IResolvedTier, IRunSelection } from "./types";

const NO_GLOBAL_TIMEOUT = 0;

export function selectedProfileName(): string {
  return (
    process.env.E2E_PROFILE ?? loadE2eConfig().default_profile
  ).toLowerCase();
}

/** Which tiers a profile runs on an environment; tiers the environment does not allow are dropped. */
export function resolveRun(
  environmentName: string,
  profileName: string
): IRunSelection {
  const config = loadE2eConfig();
  const environment = buildEnvironment(environmentName);
  const profile = config.profiles[profileName];
  if (profile === undefined) {
    const known = Object.keys(config.profiles).join(", ");
    throw new Error(
      `Unknown profile "${profileName}" — e2e.config.yaml defines: ${known}`
    );
  }

  const allowedTiers = environment.allowedTiers;
  const tierNames = profile.tiers.filter(
    (tierName) => allowedTiers === null || allowedTiers.includes(tierName)
  );
  const tiers: IResolvedTier[] = tierNames.map((tierName) => {
    const settings = config.tiers[tierName];
    const droppedNeeds = settings.needs.filter(
      (need) => !tierNames.includes(need)
    );
    if (droppedNeeds.length > 0) {
      throw new Error(
        `Tier "${tierName}" needs "${droppedNeeds.join(
          ", "
        )}", which ${environmentName} does not allow (allowed_tiers)`
      );
    }
    return {
      name: tierName,
      workers: settings.workers,
      retries: settings.retries,
      needs: settings.needs,
      readOnly: settings.read_only,
    };
  });

  if (tiers.length === 0) {
    throw new Error(
      `Profile "${profileName}" has no tier that ${environmentName} allows`
    );
  }

  return {
    environment,
    profileName,
    tiers,
    skippedTiers: profile.tiers.filter(
      (tierName) => !tierNames.includes(tierName)
    ),
    globalTimeoutMs: parseDuration(profile.global_timeout, NO_GLOBAL_TIMEOUT),
  };
}

/** The run described by E2E_ENV (default staging) and E2E_PROFILE (default from the config). */
export function selectRun(): IRunSelection {
  return resolveRun(selectedEnvironmentName(), selectedProfileName());
}
