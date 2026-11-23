import { type DynamicModule, Global, Module } from "@nestjs/common";
import { AgentRuns } from "../agents/agent-runs";
import type { IRunFiles } from "../files/run-files";
import { IngestService } from "../ingest/service";
import { RunManager } from "../run-manager";
import { CiSource } from "../sources/bitbucket";
import { createSkillStore } from "../skills/create-skill-store";
import type { ISkillStore } from "../skills/skill-stores";
import { SseHub } from "../sse-hub";
import type {
  IAccessControl,
  IConsoleSettings,
  IRunners,
  IWorkspace,
} from "../types";
import { createWorkspace } from "../workspaces/strategies";
import {
  ACCESS,
  RUN_FILES,
  RUNNERS,
  SETTINGS,
  SKILL_STORE,
  WORKSPACE,
} from "./tokens";

// The console's services, shared by every feature module. They are plain classes that know
// nothing of Nest; this module builds them from the console's settings (config.ts) in the order
// they need each other.

export interface ICoreParts {
  settings: IConsoleSettings;
  runners: IRunners;
  access: IAccessControl;
  runFiles: IRunFiles;
}

@Global()
@Module({})
export class CoreModule {
  static forRoot(parts: ICoreParts): DynamicModule {
    const { settings, runners, access, runFiles } = parts;
    return {
      module: CoreModule,
      providers: [
        { provide: SETTINGS, useValue: settings },
        { provide: RUNNERS, useValue: runners },
        { provide: ACCESS, useValue: access },
        { provide: RUN_FILES, useValue: runFiles },
        {
          provide: WORKSPACE,
          useFactory: () => createWorkspace(settings, runners),
        },
        { provide: SseHub, useFactory: () => new SseHub() },
        {
          provide: SKILL_STORE,
          useFactory: () => createSkillStore(settings),
        },
        {
          provide: AgentRuns,
          useFactory: (workspace: IWorkspace, skills: ISkillStore) =>
            new AgentRuns(settings, runners, workspace, skills),
          inject: [WORKSPACE, SKILL_STORE],
        },
        {
          provide: RunManager,
          useFactory: (hub: SseHub, workspace: IWorkspace, agents: AgentRuns) =>
            new RunManager(hub, workspace, runners, agents),
          inject: [SseHub, WORKSPACE, AgentRuns],
        },
        {
          provide: CiSource,
          useFactory: (hub: SseHub, manager: RunManager) =>
            new CiSource(hub, manager),
          inject: [SseHub, RunManager],
        },
        {
          provide: IngestService,
          useFactory: (manager: RunManager, ci: CiSource, hub: SseHub) =>
            new IngestService(manager, ci, hub, settings),
          inject: [RunManager, CiSource, SseHub],
        },
      ],
      exports: [
        SETTINGS,
        RUNNERS,
        ACCESS,
        RUN_FILES,
        WORKSPACE,
        SKILL_STORE,
        SseHub,
        AgentRuns,
        RunManager,
        CiSource,
        IngestService,
      ],
    };
  }
}
