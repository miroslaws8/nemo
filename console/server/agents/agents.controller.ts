import { Body, Controller, Get, Post } from "@nestjs/common";
import { startAgentRunRequestSchema } from "../../shared/api";
import type {
  IAgentSkills,
  IRunRecord,
  IStartAgentRunRequest,
} from "../../shared/types";
import {
  isGuarded,
  requireOnEnvironment,
  requireRole,
} from "../auth/permissions";
import { Access } from "../common/access.decorator";
import { Actor, SearchParams } from "../common/request-params";
import { ZodBodyPipe } from "../common/zod-body.pipe";
import { requireOffered } from "../environments";
import { RunManager } from "../run-manager";
import { requiredQuery } from "../system/system.controller";
import type { IActor } from "../types";
import { AgentRuns } from "./agent-runs";

// Agent checks: the skills a check may run, and starting one (a run like the others from then
// on: /api/runs/<id> shows, stops and repeats it). Starting one takes the role of its environment.

@Controller("api")
export class AgentsController {
  constructor(
    private readonly agents: AgentRuns,
    private readonly manager: RunManager
  ) {}

  @Get("agents/skills")
  @Access("viewer")
  skills(@SearchParams() query: URLSearchParams): Promise<IAgentSkills> {
    const env = requireOffered(requiredQuery(query, "env").toLowerCase()).name;
    return this.agents.skills(env, query.get("ref"));
  }

  @Post("agent-runs")
  @Access("runner")
  start(
    @Body(new ZodBodyPipe(startAgentRunRequestSchema))
    request: IStartAgentRunRequest,
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
      `Running an agent check on ${env}`
    );
    return this.manager.startAgent(request, actor.email);
  }
}
