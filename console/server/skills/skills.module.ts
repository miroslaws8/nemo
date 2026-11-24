import { Module } from "@nestjs/common";
import { AgentRuns } from "../agents/agent-runs";
import { SKILL_STORE, WORKSPACE } from "../core/tokens";
import type { IWorkspace } from "../types";
import { SkillCatalog } from "./skill-catalog";
import { SkillChecks } from "./skill-check";
import { SkillWriter } from "./skill-writer";
import type { ISkillStore } from "./skill-stores";
import { SkillsController } from "./skills.controller";

@Module({
  controllers: [SkillsController],
  providers: [
    {
      provide: SkillCatalog,
      useFactory: (
        workspace: IWorkspace,
        store: ISkillStore,
        agents: AgentRuns
      ) => new SkillCatalog(workspace, store, agents),
      inject: [WORKSPACE, SKILL_STORE, AgentRuns],
    },
    {
      provide: SkillChecks,
      useFactory: (store: ISkillStore, catalog: SkillCatalog) =>
        new SkillChecks(store, catalog),
      inject: [SKILL_STORE, SkillCatalog],
    },
    {
      provide: SkillWriter,
      useFactory: (
        checks: SkillChecks,
        catalog: SkillCatalog,
        agents: AgentRuns
      ) => new SkillWriter(checks, catalog, agents),
      inject: [SkillChecks, SkillCatalog, AgentRuns],
    },
  ],
})
export class SkillsModule {}
