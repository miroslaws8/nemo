import { Module } from "@nestjs/common";
import { IngestController } from "./ingest.controller";
import { IngestTokenGuard } from "./ingest-token.guard";

@Module({ controllers: [IngestController], providers: [IngestTokenGuard] })
export class IngestModule {}
