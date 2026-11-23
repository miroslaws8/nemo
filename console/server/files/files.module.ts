import { Module } from "@nestjs/common";
import { FilesHostController } from "./files-host.controller";
import { FilesController } from "./files.controller";

@Module({ controllers: [FilesController, FilesHostController] })
export class FilesModule {}
