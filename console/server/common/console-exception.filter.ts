import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { HttpError } from "../http-error";
import { requestState } from "./request-state";

// Every failure answers {error: "<what went wrong>"} with its status, as the web app expects; a
// page (not the API) that needs a session sends the browser to sign in, and back. What went wrong
// also goes to the audit log (request.middleware.ts).

function describe(
  exception: unknown,
  method: string
): { status: number; message: string } {
  if (exception instanceof HttpError) {
    return { status: exception.status, message: exception.message };
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    // Nest's own "no such route": the path is the console's, the method is not.
    if (status === 404 && method !== "GET") {
      return { status: 405, message: "not here" };
    }
    return { status, message: exception.message };
  }
  return {
    status: 500,
    message: exception instanceof Error ? exception.message : String(exception),
  };
}

@Catch()
export class ConsoleExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const request = host.switchToHttp().getRequest<Request>();
    const response = host.switchToHttp().getResponse<Response>();
    const { status, message } = describe(exception, request.method);
    const state = requestState(request);
    state.error = message;
    if (response.headersSent) {
      response.end();
      return;
    }
    if (
      status === 401 &&
      request.method === "GET" &&
      !state.pathname.startsWith("/api/")
    ) {
      response.writeHead(302, {
        location: `/auth/login?returnTo=${encodeURIComponent(
          request.originalUrl
        )}`,
        "cache-control": "no-store",
      });
      response.end();
      return;
    }
    response.status(status).json({ error: message });
  }
}
