import { loadE2eConfig } from "../../engine/config";
import { buildEnvironment } from "../../engine/environment";
import type { IEnvironment } from "../../engine/types";
import { consoleSettings } from "./config";
import { HttpError } from "./http-error";

// The environments of e2e.config.yaml this console offers: a server leaves out the ones only a
// developer's machine reaches (local_only, like the app on localhost).

function offered(environment: IEnvironment): boolean {
  return consoleSettings().localOnlyEnvironments || !environment.localOnly;
}

/** The environments to show and run, in the config's order. */
export function offeredEnvironments(): IEnvironment[] {
  return Object.keys(loadE2eConfig().environments)
    .map((name) => buildEnvironment(name))
    .filter(offered);
}

/** An environment this console offers (400 for one it does not know or does not offer). */
export function requireOffered(env: string): IEnvironment {
  let environment: IEnvironment;
  try {
    environment = buildEnvironment(env);
  } catch (error) {
    throw new HttpError(
      400,
      error instanceof Error ? error.message : String(error)
    );
  }
  if (!offered(environment)) {
    throw new HttpError(
      400,
      `${env} is reached only from a developer's machine (local_only): this console does not run it`
    );
  }
  return environment;
}
