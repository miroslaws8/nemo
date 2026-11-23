import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from "@nestjs/common";
import type { Request } from "express";
import { IngestService } from "./service";

/** CI's token (QA_CONSOLE_INGEST_TOKENS) instead of a session; checked before the body is. */
@Injectable()
export class IngestTokenGuard implements CanActivate {
  constructor(private readonly ingest: IngestService) {}

  canActivate(context: ExecutionContext): boolean {
    this.ingest.requireToken(context.switchToHttp().getRequest<Request>());
    return true;
  }
}
