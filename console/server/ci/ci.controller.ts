import { Body, Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import { z } from "zod";
import { ciRerunRequestSchema, cleanupRequestSchema } from "../../shared/api";
import type {
  ICiDetail,
  ICiLog,
  ICiOverview,
  ICiPipeline,
  ICiRerunRequest,
  ICleanupRequest,
  ISweepResult,
} from "../../shared/types";
import { requireOnEnvironment } from "../auth/permissions";
import { Access } from "../common/access.decorator";
import { Actor, SearchParams } from "../common/request-params";
import { ZodBodyPipe } from "../common/zod-body.pipe";
import { HttpError } from "../http-error";
import { CiSource } from "../sources/bitbucket";
import type { IActor } from "../types";

// The repository's e2e pipelines on Bitbucket (console/server/sources): the list, a pipeline's
// steps, report and log, and stopping, rerunning and cleaning up after one. A pipeline that
// touches a guarded environment takes an operator.

const BUILD_NUMBER = /^\d+$/;
// Bitbucket's uuids come in braces.
const STEP_UUID = /^\{[0-9a-f-]+\}$/i;
// Bitbucket stops a pipeline one way: there is no force.
const stopPipelineRequestSchema = z.strictObject({});

function buildNumber(number: string): number {
  if (!BUILD_NUMBER.test(number)) {
    throw new HttpError(404, `no pipeline ${number}`);
  }
  return Number(number);
}

function stepUuid(step: string): string {
  if (!STEP_UUID.test(step)) {
    throw new HttpError(404, `no step ${step}`);
  }
  return step;
}

@Controller("api/ci")
export class CiController {
  constructor(private readonly ci: CiSource) {}

  @Get()
  @Access("viewer")
  overview(): Promise<ICiOverview> {
    return this.ci.current();
  }

  @Get("pipelines/:number")
  @Access("viewer")
  pipeline(@Param("number") number: string): Promise<ICiDetail> {
    return this.ci.detail(buildNumber(number));
  }

  @Get("pipelines/:number/steps/:step/log")
  @Access("viewer")
  log(
    @Param("number") number: string,
    @Param("step") step: string,
    @SearchParams() query: URLSearchParams
  ): Promise<ICiLog> {
    return this.ci.log(
      buildNumber(number),
      stepUuid(step),
      Number(query.get("offset") ?? 0) || 0
    );
  }

  @Post("pipelines/:number/stop")
  @Access("runner")
  @HttpCode(200)
  async stop(
    @Param("number") number: string,
    @Body(new ZodBodyPipe(stopPipelineRequestSchema)) _request: object,
    @Actor() actor: IActor
  ): Promise<ICiPipeline> {
    const build = await this.requireOnPipeline(actor, number, "Stopping");
    return this.ci.stopPipeline(build);
  }

  @Post("pipelines/:number/rerun")
  @Access("runner")
  async rerun(
    @Param("number") number: string,
    @Body(new ZodBodyPipe(ciRerunRequestSchema)) request: ICiRerunRequest,
    @Actor() actor: IActor
  ): Promise<ICiPipeline> {
    const build = await this.requireOnPipeline(actor, number, "Running again");
    return this.ci.rerun(build, request.confirm);
  }

  @Post("pipelines/:number/cleanup")
  @Access("runner")
  @HttpCode(200)
  async cleanup(
    @Param("number") number: string,
    @Body(new ZodBodyPipe(cleanupRequestSchema)) request: ICleanupRequest,
    @Actor() actor: IActor
  ): Promise<ISweepResult> {
    const build = await this.requireOnPipeline(
      actor,
      number,
      "Cleaning up after"
    );
    return this.ci.cleanup(build, request.apply, request.confirm);
  }

  // Acting on a pipeline: one that touches a guarded environment takes an operator.
  private async requireOnPipeline(
    actor: IActor,
    number: string,
    what: string
  ): Promise<number> {
    const build = buildNumber(number);
    const pipeline = await this.ci.pipelineOf(build);
    requireOnEnvironment(
      actor,
      "act",
      pipeline.guardedEnv !== null,
      `${what} pipeline #${build}`
    );
    return build;
  }
}
