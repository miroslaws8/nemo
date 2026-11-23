import { Controller, Get, Inject, Param, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { Access } from "../common/access.decorator";
import { Actor, SearchParams } from "../common/request-params";
import { requestState } from "../common/request-state";
import { RUN_FILES } from "../core/tokens";
import { RunManager } from "../run-manager";
import { runIdFrom } from "../run-store";
import type { IActor } from "../types";
import {
  folderFile,
  type IRunFiles,
  reportFile,
  requireReadable,
} from "./run-files";

// A run's files at the console's own address (run-files.ts decides what they get): its HTML
// report (and trace viewer) and the files of its folders. Live screenshots go to whoever may
// watch the run; the report and attachments (traces hold session tokens) to whoever may read its
// environment's reports.

/** A wildcard's segments as one relative path ("" for none). */
export function joinedPath(segments: string[] | string | undefined): string {
  return Array.isArray(segments) ? segments.join("/") : segments ?? "";
}

/** The report's address without its trailing slash: its relative links need one. */
export function isBareReport(request: Request): boolean {
  return requestState(request).pathname.endsWith("/report");
}

@Controller("runs")
export class FilesController {
  constructor(
    private readonly manager: RunManager,
    @Inject(RUN_FILES) private readonly files: IRunFiles
  ) {}

  @Get(":id/report{/*path}")
  @Access("viewer")
  report(
    @Param("id") id: string,
    @Param("path") segments: string[] | undefined,
    @Req() request: Request,
    @Res() response: Response,
    @SearchParams() query: URLSearchParams,
    @Actor() actor: IActor
  ): void {
    if (isBareReport(request)) {
      response.redirect(
        302,
        `/runs/${encodeURIComponent(runIdFrom({ id }))}/report/`
      );
      return;
    }
    const file = reportFile(id, joinedPath(segments));
    requireReadable(this.manager, actor, file.id);
    this.files.deliver({ request, response, query }, file);
  }

  @Get(":id/files/:folder/*path")
  @Access("viewer")
  file(
    @Param("id") id: string,
    @Param("folder") folder: string,
    @Param("path") segments: string[] | undefined,
    @Req() request: Request,
    @Res() response: Response,
    @SearchParams() query: URLSearchParams,
    @Actor() actor: IActor
  ): void {
    const file = folderFile(id, folder, joinedPath(segments));
    if (file.scope === "report") {
      requireReadable(this.manager, actor, file.id);
    }
    this.files.deliver({ request, response, query }, file);
  }
}
