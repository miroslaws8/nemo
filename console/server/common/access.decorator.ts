import { SetMetadata } from "@nestjs/common";
import type { IRouteAccess } from "../types";

export const ACCESS_KEY = "qa-console:access";

/**
 * Who may call this route: anyone ("open"), or a role and the ones above it. Every route says it
 * (AccessGuard refuses one that does not); a route acting on an environment also checks the role
 * that environment takes (requireOnEnvironment).
 */
export const Access = (access: IRouteAccess): ReturnType<typeof SetMetadata> =>
  SetMetadata(ACCESS_KEY, access);
