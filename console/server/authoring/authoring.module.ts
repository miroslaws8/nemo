import { Module } from "@nestjs/common";
import { AuthoringController } from "./authoring.controller";

@Module({ controllers: [AuthoringController] })
export class AuthoringModule {}
