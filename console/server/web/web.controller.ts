import fs from "node:fs";
import { Controller, Get, Param, Res } from "@nestjs/common";
import type { Response } from "express";
import { Access } from "../common/access.decorator";
import { HttpError } from "../http-error";
import { WEB_DIST_DIR } from "../settings";
import { serveFile } from "../static";
import { joinedPath } from "../files/files.controller";

// The web app (console/web/dist). It routes on the client: anything that is not one of its files
// is its index.html. WebModule comes last, so this answers only the GETs nothing else does.

@Controller()
export class WebController {
  @Get("{*path}")
  @Access("open")
  page(
    @Param("path") segments: string[] | undefined,
    @Res() response: Response
  ): void {
    const relative = joinedPath(segments);
    if (relative === "api" || relative.startsWith("api/")) {
      throw new HttpError(404, "not found");
    }
    if (!fs.existsSync(WEB_DIST_DIR)) {
      response.status(200).json({
        app: "qa-console",
        web: "not built yet — run `pnpm console:setup` (the API works without it)",
      });
      return;
    }
    const served =
      serveFile(response, WEB_DIST_DIR, relative) ||
      serveFile(response, WEB_DIST_DIR, "index.html");
    if (!served) {
      throw new HttpError(404, "not found");
    }
  }
}
