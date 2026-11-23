import path from "node:path";
import { Controller, Get, Inject, Res } from "@nestjs/common";
import type { Response } from "express";
import { loadE2eConfig } from "../../../engine/config";
import { DEFAULT_ENVIRONMENT } from "../../../engine/environment";
import type {
  IBranch,
  ICatalogTest,
  IConsoleConfig,
  IRole,
  IRunSource,
  ISourceSnippet,
} from "../../shared/types";
import { AgentRuns } from "../agents/agent-runs";
import { requireRole } from "../auth/permissions";
import { Access } from "../common/access.decorator";
import { Actor, SearchParams } from "../common/request-params";
import { SETTINGS, SKILL_STORE, WORKSPACE } from "../core/tokens";
import type { ISkillStore } from "../skills/skill-stores";
import { offeredEnvironments, requireOffered } from "../environments";
import { HttpError } from "../http-error";
import { RunManager } from "../run-manager";
import { runIdFrom } from "../run-store";
import type {
  IActor,
  IConsoleMode,
  IConsoleSettings,
  IWorkspace,
} from "../types";

// The console itself: probes, who is signed in, the config the web app builds its forms from, the
// tests a profile has, the branches a run may test and the YAML a step points at.

const SOURCE_CONTEXT_LINES = 6;
const SOURCE_FOLDERS = ["tests", "templates", "data"];
const YAML_FILE = /\.ya?ml$/;

export function requiredQuery(query: URLSearchParams, name: string): string {
  const value = query.get(name);
  if (value === null || value === "") {
    throw new HttpError(400, `missing ?${name}=`);
  }
  return value;
}

@Controller("api")
export class SystemController {
  constructor(
    @Inject(SETTINGS) private readonly settings: IConsoleSettings,
    @Inject(WORKSPACE) private readonly workspace: IWorkspace,
    private readonly manager: RunManager,
    private readonly agents: AgentRuns,
    @Inject(SKILL_STORE) private readonly skillStore: ISkillStore
  ) {}

  @Get("health")
  @Access("open")
  health(): { app: string; pid: number; build: string } {
    return { app: "qa-console", pid: process.pid, build: this.settings.build };
  }

  // Ready for work: not while the console shuts down (a server stops its runs first).
  @Get("ready")
  @Access("open")
  ready(@Res({ passthrough: true }) response: Response): { ready: boolean } {
    const draining = this.manager.isDraining();
    response.status(draining ? 503 : 200);
    return { ready: !draining };
  }

  @Get("me")
  @Access("viewer")
  me(@Actor() actor: IActor): {
    mode: IConsoleMode;
    email: string | null;
    role: IRole;
  } {
    return {
      mode: this.settings.mode,
      email: actor.email,
      role: requireRole(actor, "viewer", "This"),
    };
  }

  @Get("config")
  @Access("viewer")
  config(): IConsoleConfig {
    const config = loadE2eConfig();
    return {
      environments: offeredEnvironments().map((environment) => ({
        name: environment.name,
        baseUrl: environment.baseUrl,
        guarded: environment.guarded,
        branch: environment.branch,
      })),
      tiers: Object.entries(config.tiers).map(([name, tier]) => ({
        name,
        description: tier.description ?? null,
        needs: tier.needs,
        readOnly: tier.read_only,
      })),
      profiles: Object.entries(config.profiles).map(([name, profile]) => ({
        name,
        tiers: profile.tiers,
        description: profile.description ?? null,
      })),
      defaultEnvironment: DEFAULT_ENVIRONMENT,
      defaultProfile: config.default_profile,
      testsFrom: this.workspace.testsFrom,
      commitUrl: this.workspace.commitUrl(),
      skillStore: {
        kind: this.skillStore.kind,
        editable: this.skillStore.readOnly === null,
        reason: this.skillStore.readOnly,
        channels: this.skillStore.kind !== "working-tree",
      },
      agents: this.agents.info(),
    };
  }

  @Get("catalog")
  @Access("viewer")
  async catalog(
    @SearchParams() query: URLSearchParams
  ): Promise<{ source: IRunSource; tests: ICatalogTest[] }> {
    const env = requireOffered(requiredQuery(query, "env").toLowerCase()).name;
    const profile = requiredQuery(query, "profile").toLowerCase();
    const source = await this.workspace.resolve(env, profile, query.get("ref"));
    const tests = await this.workspace.catalog(
      env,
      profile,
      source,
      query.get("refresh") === "1"
    );
    return { source, tests };
  }

  // The branches a run may test: a server console's only; not for viewers, who run nothing.
  @Get("branches")
  @Access("runner")
  branches(): Promise<IBranch[]> {
    return this.workspace.branches();
  }

  // The YAML around one line, as the run's commit has it (a local console: as the file is now).
  @Get("source")
  @Access("viewer")
  async source(
    @SearchParams() query: URLSearchParams
  ): Promise<ISourceSnippet> {
    const runId = query.get("run");
    const source =
      runId === null ? null : this.manager.sourceOf(runIdFrom({ id: runId }));
    const file = requiredQuery(query, "file");
    const line = Number(requiredQuery(query, "line")) || 1;
    // Normalized, a path that climbs out no longer starts in one of the folders.
    const normalized = path.posix.normalize(file);
    const allowed =
      YAML_FILE.test(normalized) &&
      SOURCE_FOLDERS.some((folder) => normalized.startsWith(`${folder}/`));
    const text = allowed
      ? await this.workspace.readFile(source, normalized)
      : null;
    if (text === null) {
      throw new HttpError(
        404,
        `no YAML ${file} under tests/, templates/ or data/`
      );
    }
    const all = text.split("\n");
    const from = Math.max(1, line - SOURCE_CONTEXT_LINES);
    const to = Math.min(all.length, line + SOURCE_CONTEXT_LINES);
    return {
      file: normalized,
      line,
      lines: all
        .slice(from - 1, to)
        .map((lineText, index) => ({ number: from + index, text: lineText })),
    };
  }
}
