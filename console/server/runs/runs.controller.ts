import { Body, Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import {
  cleanupRequestSchema,
  retryRequestSchema,
  startRunRequestSchema,
  stopRequestSchema,
} from "../../shared/api";
import type {
  ICleanupRequest,
  ILogChunk,
  IRetryRequest,
  IRunDetail,
  IRunRecord,
  IStartRunRequest,
  IStopRequest,
  ISweepResult,
} from "../../shared/types";
import {
  isGuarded,
  requireOnEnvironment,
  requireRole,
} from "../auth/permissions";
import { Access } from "../common/access.decorator";
import { Actor, SearchParams } from "../common/request-params";
import { ZodBodyPipe } from "../common/zod-body.pipe";
import { RunManager } from "../run-manager";
import { runIdFrom } from "../run-store";
import type { IActor } from "../types";
import { readLog } from "./run-log";

// The console's own runs: the list, starting one, a run's detail and log, and stopping, retrying
// and cleaning up after it. Acting on a run takes the role of its environment (prod: an operator).

@Controller("api/runs")
export class RunsController {
  constructor(private readonly manager: RunManager) {}

  @Get()
  @Access("viewer")
  list(@SearchParams() query: URLSearchParams): IRunRecord[] {
    return this.manager.runs(query.get("env"));
  }

  @Post()
  @Access("runner")
  start(
    @Body(new ZodBodyPipe(startRunRequestSchema)) request: IStartRunRequest,
    @Actor() actor: IActor
  ): Promise<IRunRecord> {
    const env = request.env.toLowerCase();
    if (request.alongsideCi === true) {
      requireRole(actor, "operator", "Starting a run alongside CI");
    }
    requireOnEnvironment(
      actor,
      "act",
      isGuarded(env),
      `Running tests on ${env}`
    );
    return this.manager.start(request, actor.email);
  }

  @Get(":id")
  @Access("viewer")
  detail(@Param("id") id: string): IRunDetail {
    return this.manager.detail(runIdFrom({ id }));
  }

  @Post(":id/stop")
  @Access("runner")
  @HttpCode(200)
  stop(
    @Param("id") id: string,
    @Body(new ZodBodyPipe(stopRequestSchema)) request: IStopRequest,
    @Actor() actor: IActor
  ): IRunRecord {
    const runId = this.requireOnRun(actor, id, "Stopping a run");
    return this.manager.stop(runId, request.force ?? false, actor.email);
  }

  @Post(":id/retry")
  @Access("runner")
  retry(
    @Param("id") id: string,
    @Body(new ZodBodyPipe(retryRequestSchema)) request: IRetryRequest,
    @Actor() actor: IActor
  ): Promise<IRunRecord> {
    const runId = this.requireOnRun(actor, id, "Running tests again");
    return this.manager.retry(runId, request, actor.email);
  }

  @Post(":id/cleanup")
  @Access("runner")
  @HttpCode(200)
  cleanup(
    @Param("id") id: string,
    @Body(new ZodBodyPipe(cleanupRequestSchema)) request: ICleanupRequest,
    @Actor() actor: IActor
  ): Promise<ISweepResult> {
    const runId = this.requireOnRun(actor, id, "Cleaning up");
    return this.manager.cleanup(runId, request.apply, request.confirm);
  }

  @Get(":id/log")
  @Access("viewer")
  log(
    @Param("id") id: string,
    @SearchParams() query: URLSearchParams
  ): ILogChunk {
    return readLog(runIdFrom({ id }), Number(query.get("offset") ?? 0) || 0);
  }

  // Acting on a run takes the role of its environment.
  private requireOnRun(actor: IActor, id: string, what: string): string {
    const runId = runIdFrom({ id });
    const env = this.manager.environmentOf(runId);
    requireOnEnvironment(actor, "act", isGuarded(env), `${what} on ${env}`);
    return runId;
  }
}
