import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { skillNameProblem } from "../../../engine/skill-schema";
import {
  addSkillRequestSchema,
  promoteSkillRequestSchema,
  replaceSkillRequestSchema,
  skillCheckRequestSchema,
  writeSkillRequestSchema,
} from "../../shared/api";
import { SKILL_EDITOR } from "../../shared/access";
import type {
  IAddSkillRequest,
  IPromoteSkillRequest,
  IReplaceSkillRequest,
  ISkillCheck,
  ISkillCheckRequest,
  ISkillDetail,
  ISkillExample,
  ISkillTemplateList,
  ISkillList,
  ISkillOrigin,
  ISkillWritten,
  IWriteSkillRequest,
} from "../../shared/types";
import { Access } from "../common/access.decorator";
import { Actor, SearchParams } from "../common/request-params";
import { ZodBodyPipe } from "../common/zod-body.pipe";
import { HttpError } from "../http-error";
import type { IActor } from "../types";
import { SkillCatalog } from "./skill-catalog";
import { SkillChecks } from "./skill-check";
import { SkillWriter } from "./skill-writer";

// The Skills page (docs/guide.md → QA Console → Skills): every skill agent checks may follow, and adding
// one or giving one a new version from a skill.yaml — checked, then written (a local console: the
// working tree; a server: its own store) without anything left to run by hand. Reading takes a
// viewer, changing takes SKILL_EDITOR (console/shared/access.ts).

function requireName(name: string): string {
  const problem = skillNameProblem(name);
  if (problem !== null) {
    throw new HttpError(400, problem);
  }
  return name;
}

function originOf(query: URLSearchParams): ISkillOrigin | null {
  const origin = query.get("origin");
  if (origin === null || origin === "") {
    return null;
  }
  if (origin !== "repo" && origin !== "console") {
    throw new HttpError(400, "origin is repo or console");
  }
  return origin;
}

function versionOf(query: URLSearchParams): number | null {
  const version = query.get("version");
  if (version === null || version === "") {
    return null;
  }
  const number = Number(version);
  if (!Number.isInteger(number) || number < 1) {
    throw new HttpError(400, "version is a whole number from 1");
  }
  return number;
}

@Controller("api/skills")
export class SkillsController {
  constructor(
    private readonly catalog: SkillCatalog,
    private readonly checks: SkillChecks,
    private readonly writer: SkillWriter
  ) {}

  @Get()
  @Access("viewer")
  list(@SearchParams() query: URLSearchParams): Promise<ISkillList> {
    return this.catalog.list(query.get("ref"));
  }

  @Get("example")
  @Access("viewer")
  example(): Promise<ISkillExample> {
    return this.catalog.example();
  }

  @Get("templates")
  @Access("viewer")
  templates(): Promise<ISkillTemplateList> {
    return this.catalog.templates();
  }

  @Get(":name")
  @Access("viewer")
  detail(
    @Param("name") name: string,
    @SearchParams() query: URLSearchParams
  ): Promise<ISkillDetail> {
    return this.catalog.detail(
      requireName(name),
      query.get("ref"),
      originOf(query)
    );
  }

  @Get(":name/skill.yaml")
  @Access("viewer")
  async download(
    @Param("name") name: string,
    @SearchParams() query: URLSearchParams,
    @Res() response: Response
  ): Promise<void> {
    const text = await this.catalog.yamlFile(
      requireName(name),
      query.get("ref"),
      originOf(query),
      versionOf(query)
    );
    response
      .status(200)
      .type("text/yaml; charset=utf-8")
      .attachment(`${name}.skill.yaml`)
      .send(text);
  }

  // A skill.yaml written by AI from a description, checked; nothing is added (the form does that).
  @Post("write")
  @Access(SKILL_EDITOR)
  @HttpCode(200)
  write(
    @Body(new ZodBodyPipe(writeSkillRequestSchema)) request: IWriteSkillRequest
  ): Promise<ISkillWritten> {
    return this.writer.write(request.description);
  }

  // Changes nothing: the page asks at every pause in typing (not in the audit log).
  @Post("check")
  @Access(SKILL_EDITOR)
  @HttpCode(200)
  check(
    @Body(new ZodBodyPipe(skillCheckRequestSchema)) request: ISkillCheckRequest
  ): Promise<ISkillCheck> {
    return this.checks.check(request);
  }

  @Post()
  @Access(SKILL_EDITOR)
  add(
    @Body(new ZodBodyPipe(addSkillRequestSchema)) request: IAddSkillRequest,
    @Actor() actor: IActor
  ): Promise<ISkillDetail> {
    return this.checks.add(request, actor.email);
  }

  @Post(":name/versions")
  @Access(SKILL_EDITOR)
  replace(
    @Param("name") name: string,
    @Body(new ZodBodyPipe(replaceSkillRequestSchema))
    request: IReplaceSkillRequest,
    @Actor() actor: IActor
  ): Promise<ISkillDetail> {
    return this.checks.replace(requireName(name), request, actor.email);
  }

  // A POST like every change, so that the Origin check and the audit log take it too.
  @Post(":name/delete")
  @Access(SKILL_EDITOR)
  remove(@Param("name") name: string): Promise<{ deleted: string }> {
    return this.checks.remove(requireName(name));
  }

  // Prod runs the version promoted (its skill_channel); the other environments the newest.
  @Post(":name/promote")
  @Access(SKILL_EDITOR)
  promote(
    @Param("name") name: string,
    @Body(new ZodBodyPipe(promoteSkillRequestSchema))
    request: IPromoteSkillRequest,
    @Actor() actor: IActor
  ): Promise<ISkillDetail> {
    return this.checks.promote(requireName(name), request.version, actor.email);
  }
}
