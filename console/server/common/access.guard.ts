import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { requireRole } from "../auth/permissions";
import { HttpError } from "../http-error";
import type { IRouteAccess } from "../types";
import { ACCESS_KEY } from "./access.decorator";
import { requestState } from "./request-state";

/**
 * The role each route takes (@Access): 401 when nobody signed in, 403 when the role falls short.
 * A route without @Access is refused: every route says who may call it.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const access = this.reflector.getAllAndOverride<IRouteAccess | undefined>(
      ACCESS_KEY,
      [context.getHandler(), context.getClass()]
    );
    if (access === undefined) {
      throw new HttpError(
        500,
        `${context.getClass().name}.${
          context.getHandler().name
        } declares no @Access`
      );
    }
    if (access !== "open") {
      const request = context.switchToHttp().getRequest<Request>();
      requireRole(requestState(request).actor, access, "This");
    }
    return true;
  }
}
