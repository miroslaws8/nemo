import { type DynamicModule, Module } from "@nestjs/common";
import { SIGN_IN } from "../core/tokens";
import type { ISignIn } from "../types";
import { AuthController } from "./auth.controller";

/** /auth/… for a console that signs people in (a local one has none). */
@Module({})
export class AuthModule {
  static forRoot(signIn: ISignIn): DynamicModule {
    return {
      module: AuthModule,
      controllers: [AuthController],
      providers: [{ provide: SIGN_IN, useValue: signIn }],
    };
  }
}
