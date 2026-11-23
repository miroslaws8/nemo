import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import type { IActor } from "../types";
import { requestState } from "./request-state";

// Parameter decorators for what the request middleware worked out.

/** Who sends the request (the request middleware resolved it). */
export const Actor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): IActor =>
    requestState(context.switchToHttp().getRequest<Request>()).actor
);

/** The query string as URLSearchParams (repeated keys and all), not Express's parsed object. */
export const SearchParams = createParamDecorator(
  (_data: unknown, context: ExecutionContext): URLSearchParams =>
    new URL(
      context.switchToHttp().getRequest<Request>().originalUrl,
      "http://console.local"
    ).searchParams
);
