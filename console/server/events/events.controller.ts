import { Controller, Get, Inject, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { Access } from "../common/access.decorator";
import { Actor, SearchParams } from "../common/request-params";
import { ACCESS } from "../core/tokens";
import { HttpError } from "../http-error";
import { RunManager } from "../run-manager";
import { isRunId } from "../run-store";
import { SseHub } from "../sse-hub";
import type { IAccessControl, IActor } from "../types";

// The event stream a page listens to (sse-hub.ts): the lists, and the live events of the run it
// has open from `after` (or Last-Event-ID) on. It goes on while its person may still read.

@Controller("api")
export class EventsController {
  constructor(
    private readonly hub: SseHub,
    private readonly manager: RunManager,
    @Inject(ACCESS) private readonly access: IAccessControl
  ) {}

  @Get("stream")
  @Access("viewer")
  stream(
    @Req() request: Request,
    @Res() response: Response,
    @SearchParams() query: URLSearchParams,
    @Actor() actor: IActor
  ): void {
    const runId = query.get("run");
    if (runId !== null && !isRunId(runId)) {
      throw new HttpError(404, "not found");
    }
    const lastSeen = Number(
      query.get("after") ?? request.headers["last-event-id"] ?? -1
    );
    const after = Number.isFinite(lastSeen) ? lastSeen : -1;
    this.hub.open(
      request,
      response,
      runId,
      runId === null ? [] : this.manager.backlog(runId, after),
      () => this.access.stillAllowed(actor)
    );
  }
}
