import { Module } from "@nestjs/common";
import { CiController } from "./ci.controller";

@Module({ controllers: [CiController] })
export class CiModule {}
