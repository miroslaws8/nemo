import { buildEnvironment } from "../../../engine/environment";
import { hasRole, roleFor } from "../../shared/access";
import type { IEnvironmentUse } from "../../shared/access";
import type { IRole } from "../../shared/types";
import { HttpError } from "../http-error";
import type { IActor } from "../types";

// The checks a request passes: the role its route takes, and for what it does on an environment
// the role that environment takes (console/shared/access.ts).

/** Its sender's role, if it is enough: 401 when nobody signed in, 403 when it falls short. */
export function requireRole(actor: IActor, needed: IRole, what: string): IRole {
  if (actor.role === null && actor.email === null) {
    throw new HttpError(401, "Sign in to the QA console first.");
  }
  if (actor.role === null) {
    throw new HttpError(403, `${actor.email} has no access to the QA console.`);
  }
  if (!hasRole(actor.role, needed)) {
    throw new HttpError(
      403,
      `${what} needs the ${needed} role; yours is ${actor.role}.`
    );
  }
  return actor.role;
}

export function isGuarded(env: string): boolean {
  try {
    return buildEnvironment(env).guarded;
  } catch (error) {
    throw new HttpError(
      400,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/** The same for a use of an environment: a guarded one (prod) takes an operator. */
export function requireOnEnvironment(
  actor: IActor,
  use: IEnvironmentUse,
  guarded: boolean,
  what: string
): void {
  requireRole(actor, roleFor(use, guarded), what);
}
