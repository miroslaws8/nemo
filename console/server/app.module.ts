import {
  type DynamicModule,
  type MiddlewareConsumer,
  Module,
  type NestModule,
  RequestMethod,
} from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { AgentsModule } from "./agents/agents.module";
import { createAccess } from "./auth/access";
import { AuthModule } from "./auth/auth.module";
import { CiModule } from "./ci/ci.module";
import { AccessGuard } from "./common/access.guard";
import { ConsoleExceptionFilter } from "./common/console-exception.filter";
import { RequestMiddleware } from "./common/request.middleware";
import { CoreModule } from "./core/core.module";
import { EventsModule } from "./events/events.module";
import { FilesModule } from "./files/files.module";
import { createRunFiles } from "./files/run-files";
import { IngestModule } from "./ingest/ingest.module";
import { RunsModule } from "./runs/runs.module";
import { SkillsModule } from "./skills/skills.module";
import { SystemModule } from "./system/system.module";
import type { IConsoleSettings, IRunners } from "./types";
import { WebModule } from "./web/web.module";

// The console's HTTP application: the shared services (CoreModule), a module per feature, the
// request middleware (Host, Origin, who sends it, audit), AccessGuard (the role each route takes)
// and the exception filter ({error} answers). A console that signs people in also has /auth/….

@Module({})
export class AppModule implements NestModule {
  static forRoot(settings: IConsoleSettings, runners: IRunners): DynamicModule {
    const { access, signIn } = createAccess(settings);
    return {
      module: AppModule,
      imports: [
        CoreModule.forRoot({
          settings,
          runners,
          access,
          runFiles: createRunFiles(settings),
        }),
        ...(signIn === null ? [] : [AuthModule.forRoot(signIn)]),
        SystemModule,
        RunsModule,
        AgentsModule,
        SkillsModule,
        CiModule,
        IngestModule,
        EventsModule,
        FilesModule,
        // Last: its catch-all answers the GETs nothing above does.
        WebModule,
      ],
      providers: [
        { provide: APP_GUARD, useClass: AccessGuard },
        { provide: APP_FILTER, useClass: ConsoleExceptionFilter },
      ],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestMiddleware)
      .forRoutes({ path: "{*path}", method: RequestMethod.ALL });
  }
}
