import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { Access } from "../common/access.decorator";
import { Actor, SearchParams } from "../common/request-params";
import { SIGN_IN } from "../core/tokens";
import type { IActor, IRedirect, ISignIn } from "../types";

// Signing in with the app's IdP (a server console only; docs/guide.md → Sign-in and roles).

function redirect(response: Response, to: IRedirect): void {
  response.writeHead(302, {
    location: to.location,
    "set-cookie": to.cookies,
    "cache-control": "no-store",
  });
  response.end();
}

@Controller("auth")
export class AuthController {
  constructor(@Inject(SIGN_IN) private readonly signIn: ISignIn) {}

  @Get("login")
  @Access("open")
  login(
    @SearchParams() query: URLSearchParams,
    @Res() response: Response
  ): void {
    redirect(response, this.signIn.begin(query.get("returnTo")));
  }

  @Get("callback")
  @Access("open")
  async callback(
    @Req() request: Request,
    @SearchParams() query: URLSearchParams,
    @Res() response: Response
  ): Promise<void> {
    redirect(response, await this.signIn.finish(request, query));
  }

  @Post("logout")
  @Access("open")
  @HttpCode(200)
  logout(
    @Actor() actor: IActor,
    @Res({ passthrough: true }) response: Response
  ): { signedOut: true } {
    response.setHeader("set-cookie", this.signIn.signOut(actor));
    return { signedOut: true };
  }
}
