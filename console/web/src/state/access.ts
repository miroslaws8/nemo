import { hasRole, roleFor, SKILL_EDITOR } from "@shared/access";
import type { ICiPipeline, IRole } from "@shared/types";
import type { IPermission } from "@/types";
import { consoleConfig, isGuarded } from "./config";
import { me } from "./session";

// What the person in this tab may do, by the rule the server enforces (console/shared/access.ts).
// A button they may not use is greyed out and says why. Read inside computed() to stay current.

const ALLOWED: IPermission = { allowed: true, reason: null };

// Until the environments are known, every one counts as guarded.
function guarded(environment: string): boolean {
  return consoleConfig.value === null || isGuarded(environment);
}

function permits(needed: IRole, what: string): IPermission {
  const role = me.value?.role ?? null;
  if (role === null) {
    return { allowed: false, reason: "Sign in first." };
  }
  return hasRole(role, needed)
    ? ALLOWED
    : {
        allowed: false,
        reason: `${what} needs the ${needed} role; yours is ${role}.`,
      };
}

/** Starting runs at all (some environment may still need more). */
export function mayStartRuns(): IPermission {
  return permits("runner", "Starting runs");
}

/** Starting a run while CI runs hold its environment, instead of waiting for them. */
export function mayRunAlongsideCi(): IPermission {
  return permits("operator", "Starting a run alongside CI");
}

/** Running, stopping, retrying and cleaning up on an environment. */
export function mayActOn(environment: string): IPermission {
  return permits(
    roleFor("act", guarded(environment)),
    `Running tests on ${environment}`
  );
}

/** Opening the reports, traces and attachments of an environment's runs. */
export function mayReadFilesOf(environment: string): IPermission {
  return permits(
    roleFor("read", guarded(environment)),
    `Opening the reports and traces of ${environment} runs`
  );
}

/** Adding a skill, and giving one a new version. */
export function mayEditSkills(): IPermission {
  return skillStorePermits("Adding and replacing skills");
}

/** Making a stored skill's version the one prod runs. */
export function mayPromoteSkills(): IPermission {
  return skillStorePermits("Promoting a version to prod");
}

// The skill editor's role, where this console writes its skills (a local console reading the skill
// store does not).
function skillStorePermits(what: string): IPermission {
  const store = consoleConfig.value?.skillStore;
  if (store !== undefined && !store.editable) {
    return {
      allowed: false,
      reason: `${store.reason ?? "This console does not write skills"}.`,
    };
  }
  return permits(SKILL_EDITOR, what);
}

/** Stopping, rerunning and cleaning up after a CI pipeline. */
export function mayActOnPipeline(pipeline: ICiPipeline): IPermission {
  return permits(
    roleFor("act", pipeline.guardedEnv !== null),
    `Acting on ${pipeline.guardedEnv ?? pipeline.env ?? "this"} pipelines`
  );
}
