import { Body, Controller, Get, Inject, Param, Post } from "@nestjs/common";
import { startAuthorRunRequestSchema } from "../../shared/api";
import type {
  IAuthorAnswer,
  IRunRecord,
  IStartAuthorRunRequest,
} from "../../shared/types";
import { isGuarded, requireOnEnvironment } from "../auth/permissions";
import { Access } from "../common/access.decorator";
import { Actor } from "../common/request-params";
import { ZodBodyPipe } from "../common/zod-body.pipe";
import { WORKSPACE } from "../core/tokens";
import { HttpError } from "../http-error";
import { RunManager } from "../run-manager";
import { runIdFrom } from "../run-store";
import type { IActor, IWorkspace } from "../types";
import { AuthorRuns } from "./author-runs";

// Writing a test with AI: start one (a run like the others from then on), read what it wrote,
// and add its verified draft to the tests (the working tree: a local console only).

@Controller("api")
export class AuthoringController {
  constructor(
    private readonly authors: AuthorRuns,
    private readonly manager: RunManager,
    @Inject(WORKSPACE) private readonly workspace: IWorkspace
  ) {}

  @Post("author-runs")
  @Access("runner")
  start(
    @Body(new ZodBodyPipe(startAuthorRunRequestSchema))
    request: IStartAuthorRunRequest,
    @Actor() actor: IActor
  ): Promise<IRunRecord> {
    const env = request.env.toLowerCase();
    requireOnEnvironment(
      actor,
      "act",
      isGuarded(env),
      `Writing a test on ${env}`
    );
    return this.manager.startAuthor(request, actor.email);
  }

  @Get("runs/:id/author")
  @Access("viewer")
  answer(@Param("id") id: string, @Actor() actor: IActor): IAuthorAnswer {
    const runId = runIdFrom({ id });
    const env = this.manager.environmentOf(runId);
    requireOnEnvironment(
      actor,
      "read",
      isGuarded(env),
      `Reading a run of ${env}`
    );
    return this.authors.answer(runId);
  }

  @Post("runs/:id/author/save")
  @Access("runner")
  save(@Param("id") id: string, @Actor() actor: IActor): { file: string } {
    const runId = runIdFrom({ id });
    const env = this.manager.environmentOf(runId);
    requireOnEnvironment(
      actor,
      "act",
      isGuarded(env),
      `Adding a test on ${env}`
    );
    const { result, draft } = this.authors.answer(runId);
    if (
      result === null ||
      draft === null ||
      result.verification?.verified !== true
    ) {
      throw new HttpError(409, "only a verified draft is added to the tests");
    }
    return { file: this.workspace.saveTest(env, draft.file, draft.yaml) };
  }
}
