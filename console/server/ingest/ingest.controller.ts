import {
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Request, Response } from "express";
import {
  ingestAgentChecksRequestSchema,
  ingestClaimRequestSchema,
  ingestEventsRequestSchema,
  ingestStreamRequestSchema,
} from "../../shared/api";
import type {
  IIngestAgentChecks,
  IIngestAgentChecksRequest,
  IIngestClaim,
  IIngestClaimRequest,
  IIngestCursor,
  IIngestEventsRequest,
  IIngestStreamRequest,
} from "../../shared/types";
import { Access } from "../common/access.decorator";
import { ZodBodyPipe } from "../common/zod-body.pipe";
import { IngestTokenGuard } from "./ingest-token.guard";
import { IngestService, streamIdFrom } from "./service";

// CI runs live (ci/ingest.mts, service.ts): open to CI with its token, not to people.

@Controller("api/ingest")
@UseGuards(IngestTokenGuard)
export class IngestController {
  constructor(private readonly ingest: IngestService) {}

  @Post("claims")
  @Access("open")
  @HttpCode(200)
  claim(
    @Body(new ZodBodyPipe(ingestClaimRequestSchema))
    request: IIngestClaimRequest
  ): Promise<IIngestClaim> {
    return this.ingest.claim(request);
  }

  // After a step's tests (a deploy), or a scheduled pipeline: its environment's agent checks.
  @Post("agent-checks")
  @Access("open")
  @HttpCode(200)
  queueAgentChecks(
    @Body(new ZodBodyPipe(ingestAgentChecksRequestSchema))
    request: IIngestAgentChecksRequest
  ): Promise<IIngestAgentChecks> {
    return this.ingest.queueAgentChecks(request);
  }

  @Post("streams")
  @Access("open")
  openStream(
    @Body(new ZodBodyPipe(ingestStreamRequestSchema))
    request: IIngestStreamRequest
  ): Promise<IIngestCursor> {
    return this.ingest.openStream(request);
  }

  // 409 with the cursor when the batch does not start where the console expects.
  @Post("streams/:id/events")
  @Access("open")
  events(
    @Param("id") id: string,
    @Body(new ZodBodyPipe(ingestEventsRequestSchema))
    request: IIngestEventsRequest,
    @Res({ passthrough: true }) response: Response
  ): IIngestCursor {
    const { accepted, cursor } = this.ingest.events(streamIdFrom(id), request);
    response.status(accepted ? 200 : 409);
    return cursor;
  }

  @Put("streams/:id/shots/:name")
  @Access("open")
  shot(
    @Param("id") id: string,
    @Param("name") name: string,
    @Req() request: Request
  ): Promise<{ saved: string }> {
    return this.ingest.shot(streamIdFrom(id), name, request);
  }

  @Put("streams/:id/report")
  @Access("open")
  report(
    @Param("id") id: string,
    @Req() request: Request
  ): Promise<{ saved: string }> {
    return this.ingest.report(streamIdFrom(id), request);
  }
}
