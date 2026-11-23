import { Controller, Get, Inject, Param, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { Access } from "../common/access.decorator";
import { SearchParams } from "../common/request-params";
import { RUN_FILES } from "../core/tokens";
import { runIdFrom } from "../run-store";
import { isBareReport, joinedPath } from "./files.controller";
import { folderFile, type IRunFiles, reportFile } from "./run-files";

// The files origin (QA_CONSOLE_FILES_URL): a run's files by the ticket in their path, which the
// console issued for that run (run-files.ts). The request middleware lets nothing else in there.

@Controller("t/:ticket/runs")
export class FilesHostController {
  constructor(@Inject(RUN_FILES) private readonly files: IRunFiles) {}

  @Get(":id/report{/*path}")
  @Access("open")
  report(
    @Param("ticket") ticket: string,
    @Param("id") id: string,
    @Param("path") segments: string[] | undefined,
    @Req() request: Request,
    @Res() response: Response,
    @SearchParams() query: URLSearchParams
  ): void {
    // Relative to …/runs/<id>/report: the same address with its slash.
    if (isBareReport(request)) {
      runIdFrom({ id });
      response.redirect(302, "report/");
      return;
    }
    this.files.serveByTicket(
      { request, response, query },
      ticket,
      reportFile(id, joinedPath(segments))
    );
  }

  @Get(":id/files/:folder/*path")
  @Access("open")
  file(
    @Param("ticket") ticket: string,
    @Param("id") id: string,
    @Param("folder") folder: string,
    @Param("path") segments: string[] | undefined,
    @Req() request: Request,
    @Res() response: Response,
    @SearchParams() query: URLSearchParams
  ): void {
    this.files.serveByTicket(
      { request, response, query },
      ticket,
      folderFile(id, folder, joinedPath(segments))
    );
  }
}
