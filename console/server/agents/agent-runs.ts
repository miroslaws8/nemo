import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { loadE2eConfig } from "../../../engine/config";
import { buildEnvironment } from "../../../engine/environment";
import type { ISkillChannel } from "../../../engine/types";
import { parseSkillSource, SKILL_FILE } from "../../../engine/skills";
import type {
  IAgentQueuedBy,
  IAgentRun,
  IAgentSkills,
  IAgentSpend,
  IAgentsInfo,
  IRetryRequest,
  IRunDetail,
  IRunRecord,
  IRunSource,
  IStartAgentRunRequest,
} from "../../shared/types";
import { agentUsageSchema } from "../../shared/api";
import { HttpError } from "../http-error";
import {
  descriptionOf,
  readRepoSkills,
  skillTemplate,
  unavailableReason,
} from "../skills/skill-reader";
import {
  type ISkillStore,
  type IStoredSkill,
  versionOn,
} from "../skills/skill-stores";
import { SpendLedger } from "./spend-ledger";
import { runDirectory, runFile } from "../run-store";
import {
  AGENT_DEFAULT_MODEL,
  AGENT_MAX_TURNS,
  AGENT_MODELS,
  AGENT_PROVIDERS,
  AGENT_RUN_BUDGET_SECONDS,
  AGENT_SKILLS_DIR,
  AGENT_TOOLSETS,
  AGENT_WINDOW_SIZE,
  RM_PROGRAM,
} from "../settings";
import type {
  IAgentRunConfig,
  IAgentSettings,
  IConsoleSettings,
  ILaunch,
  IPreparedRun,
  IRunKind,
  IRunners,
  IRunPlan,
  IWorkspace,
} from "../types";

// Agent checks (docs/guide.md → QA Console → Agent checks): Hermes Agent runs one of nemo's skills
// (hermes/skills of the run's commit) against an environment with one of AGENT_MODELS. A check
// is a run like any other (queue, environment lock, Stop, live view); its process is
// agent-run.mts, which turns Hermes's stream into the run's events. Each environment has an
// agent home of its own (<data dir>/agent-homes/<env>: HOME, given to its runner), with the Hermes
// home in .hermes: the runner's alone (Hermes's gateway refuses a home anyone else may write), its
// vault holding that environment's QA account. A model is offered when the console has its
// provider's key (AGENT_PROVIDERS); the key reaches the check through its environment, in the
// variable Hermes reads, and agent-run.mts keeps it in .hermes/.env only while the check runs.

const AGENT_RUN_SCRIPT = path.join(__dirname, "agent-run.mts");
// Where a check's stored skill goes, in its run folder.
const STORED_SKILL_DIR = "stored-skill";
// How long the console waits for a command it runs as the runner after a check.
const RUNNER_COMMAND_MS = 30_000;
// Only what the console reads of a branch's e2e.config.yaml for CI's agent checks.
const listedChecksSchema = z.object({
  environments: z.record(
    z.string(),
    z.object({ agent_checks: z.array(z.string()).optional() })
  ),
});

// A skill a check may follow: the commit's (repo), or one added in a server console.
interface ISkill {
  name: string;
  description: string;
  unavailable: string | null;
  origin: "repo" | "console";
  version: number | null;
}

/** A command on PATH, or a path to one, that this process could run. */
function isRunnable(command: string): boolean {
  const candidates = command.includes("/")
    ? [command]
    : (process.env.PATH ?? "")
        .split(path.delimiter)
        .filter((folder) => folder !== "")
        .map((folder) => path.join(folder, command));
  return candidates.some((candidate) => {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

type IAgentModel = (typeof AGENT_MODELS)[number];

function modelOf(id: string): IAgentModel {
  const model = AGENT_MODELS.find((known) => known.id === id);
  if (model === undefined) {
    throw new HttpError(
      400,
      `the console's models are ${AGENT_MODELS.map((known) => known.id).join(
        ", "
      )}`
    );
  }
  return model;
}

function describeSource(source: IRunSource): string {
  return source.sha === null
    ? "the working tree"
    : `${source.ref ?? "?"} (${source.sha.slice(0, 7)})`;
}

export class AgentRuns implements IRunKind {
  private readonly settings: IAgentSettings;
  private readonly homesDir: string;
  private readonly ledger: SpendLedger;
  // Why the console runs no checks; null: it does.
  private readonly unavailable: string | null;

  constructor(
    settings: IConsoleSettings,
    private readonly runners: IRunners,
    private readonly workspace: IWorkspace,
    private readonly store: ISkillStore
  ) {
    this.settings = settings.agents;
    this.homesDir = path.join(settings.dataDir, "agent-homes");
    this.ledger = new SpendLedger(settings.stateDir);
    this.unavailable = !AGENT_MODELS.some(
      (model) => this.modelUnavailable(model) === null
    )
      ? `the console has no model key (${Object.values(AGENT_PROVIDERS)
          .map((provider) => provider.setting)
          .join(" or ")})`
      : isRunnable(this.settings.hermes)
      ? null
      : `the console finds no Hermes Agent (${this.settings.hermes}): install it or set QA_CONSOLE_HERMES`;
  }

  info(): IAgentsInfo {
    return {
      available: this.unavailable === null,
      reason: this.unavailable,
      models: AGENT_MODELS.map((model) => ({
        id: model.id,
        label: model.label,
        provider: AGENT_PROVIDERS[model.provider].label,
        available: this.modelUnavailable(model) === null,
        reason: this.modelUnavailable(model),
      })),
      defaultModel: this.defaultModel().id,
      limits: {
        maxTurns: AGENT_MAX_TURNS,
        budgetSeconds: AGENT_RUN_BUDGET_SECONDS,
      },
    };
  }

  /** The skills of the commit a check on `env` would run (the branch asked for, else its own). */
  async skills(env: string, ref: string | null): Promise<IAgentSkills> {
    const source = await this.workspace.resolve(env, null, ref);
    return {
      source,
      spend: this.spend(),
      skills: await this.skillsOf(source, env),
    };
  }

  /** What checks spent today against the daily limit. */
  spend(): IAgentSpend {
    return {
      todayUsd: Math.round(this.ledger.spentOn() * 10_000) / 10_000,
      dailyUsd: this.settings.dailyUsd,
    };
  }

  /** The skills CI has the console run on `env` (agent_checks in the commit's e2e.config.yaml). */
  async listedChecks(env: string, source: IRunSource): Promise<string[]> {
    const parsed = listedChecksSchema.safeParse(
      parse((await this.workspace.readFile(source, "e2e.config.yaml")) ?? "")
    );
    if (!parsed.success) {
      throw new HttpError(
        409,
        `${describeSource(source)} has no e2e.config.yaml the console can read`
      );
    }
    return parsed.data.environments[env]?.agent_checks ?? [];
  }

  /** What a new check will be: its skill (in the run's commit), model and arguments. */
  async plan(
    request: IStartAgentRunRequest,
    source: IRunSource,
    queuedBy: IAgentQueuedBy | null
  ): Promise<IAgentRun> {
    this.checkMayStart();
    const model =
      request.model === undefined
        ? this.defaultModel()
        : this.offered(request.model);
    const skill = (await this.skillsOf(source, request.env)).find(
      (found) => found.name === request.skill
    );
    if (skill === undefined) {
      throw new HttpError(
        400,
        `${describeSource(source)} has no skill ${
          request.skill
        } (${AGENT_SKILLS_DIR})`
      );
    }
    if (skill.unavailable !== null) {
      throw new HttpError(409, `${skill.name} ${skill.unavailable}`);
    }
    return {
      skill: skill.name,
      model: model.id,
      arguments: request.arguments?.trim() ?? "",
      skillOrigin: skill.origin,
      skillVersion: skill.version,
      queuedBy,
      usage: null,
    };
  }

  launch(record: IRunRecord, prepared: IPreparedRun): ILaunch {
    const agent = this.agentOf(record);
    const storedSkill =
      agent.skillOrigin === "console"
        ? this.placeStoredSkill(agent, record.id)
        : null;
    const environment = buildEnvironment(record.env);
    const home = path.join(this.homesDir, record.env);
    fs.mkdirSync(home, { recursive: true });
    this.runners.share(record.env, home);
    const model = modelOf(agent.model);
    const provider = AGENT_PROVIDERS[model.provider];
    const config: IAgentRunConfig = {
      runId: record.id,
      runDir: runDirectory(record.id),
      env: record.env,
      skill: agent.skill,
      arguments: agent.arguments,
      model: model.id,
      provider: provider.hermes,
      keyVariable: provider.keyVariable,
      cacheWrites: provider.cacheWrites,
      dataPrefix: `${loadE2eConfig().safety.data_prefix}${record.id} `,
      hermes: this.settings.hermes,
      home,
      hermesHome: path.join(home, ".hermes"),
      hermesSource: path.join(prepared.cwd, path.dirname(AGENT_SKILLS_DIR)),
      storedSkill,
      maxTurns: AGENT_MAX_TURNS,
      runBudgetSeconds: AGENT_RUN_BUDGET_SECONDS,
      toolsets: [...AGENT_TOOLSETS],
      windowSize: AGENT_WINDOW_SIZE,
      baseUrl: {
        variable: `QA_${environment.envPrefix}_URL`,
        url: environment.baseUrl,
      },
      usdPerMillion: model.usdPerMillion,
      login:
        environment.loginOrigin === null
          ? null
          : {
              origin: environment.loginOrigin,
              identifierVariable: `QA_${environment.envPrefix}_EMAIL`,
              passwordVariable: `QA_${environment.envPrefix}_PASSWORD`,
            },
    };
    const configFile = runFile(record.id, "agent.json");
    fs.writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);
    return {
      command: this.runners.node(record.env, [AGENT_RUN_SCRIPT, configFile]),
      env: {
        ...prepared.env,
        [provider.keyVariable]: this.settings.apiKeys[model.provider] ?? "",
      },
    };
  }

  retryPlan(
    parent: IRunDetail,
    _request: IRetryRequest
  ): Omit<IRunPlan, "source"> {
    const agent = this.agentOf(parent.run);
    this.checkMayStart();
    this.offered(agent.model);
    return {
      env: parent.run.env,
      profile: parent.run.profile,
      kind: "retry",
      parentId: parent.run.id,
      selection: {
        ...parent.run.selection,
        label: `again: ${parent.run.selection.label}`,
      },
      skipNeeds: false,
      alongsideCi: false,
      listLines: null,
      agent: { ...agent, queuedBy: null, usage: null },
      author: null,
    };
  }

  // The record and the day's spend keep what it spent. Should the check have been killed: its key
  // leaves the home and Hermes's gateway (a daemon) stops, as the runner.
  ended(record: IRunRecord): Partial<IRunRecord> {
    const agent = this.agentOf(record);
    const usage = this.usageOf(record.id);
    if (usage !== null) {
      this.ledger.add(record.id, usage.estimatedUsd);
    }
    const hermesHome = path.join(this.homesDir, record.env, ".hermes");
    if (fs.existsSync(hermesHome)) {
      this.asRunner(
        record.env,
        hermesHome,
        RM_PROGRAM,
        ["-f", path.join(hermesHome, ".env")],
        () =>
          this.asRunner(record.env, hermesHome, this.settings.hermes, [
            "gateway",
            "stop",
            "--yes",
          ])
      );
    }
    return { agent: { ...agent, usage } };
  }

  // Why the console does not offer a model (no key for its provider); null: it does.
  private modelUnavailable(model: IAgentModel): string | null {
    const provider = AGENT_PROVIDERS[model.provider];
    return this.settings.apiKeys[model.provider] === null
      ? `the console has no ${provider.label} key (${provider.setting})`
      : null;
  }

  // The default model when offered, else the first model that is.
  private defaultModel(): IAgentModel {
    return (
      [modelOf(AGENT_DEFAULT_MODEL), ...AGENT_MODELS].find(
        (model) => this.modelUnavailable(model) === null
      ) ?? modelOf(AGENT_DEFAULT_MODEL)
    );
  }

  // A model a check may use now: one of the console's, with its provider's key.
  private offered(id: string): IAgentModel {
    const model = modelOf(id);
    const reason = this.modelUnavailable(model);
    if (reason !== null) {
      throw new HttpError(409, `${model.label} is not offered: ${reason}`);
    }
    return model;
  }

  // A check starts (or runs again) where the console runs checks and today's limit is not spent.
  private checkMayStart(): void {
    if (this.unavailable !== null) {
      throw new HttpError(409, `No agent checks here: ${this.unavailable}`);
    }
    const { todayUsd, dailyUsd } = this.spend();
    if (todayUsd >= dailyUsd) {
      throw new HttpError(
        409,
        `Agent checks spent $${todayUsd} today, the console's limit of $${dailyUsd} (QA_CONSOLE_AGENT_DAILY_USD): they start again tomorrow (UTC)`
      );
    }
  }

  private agentOf(record: IRunRecord): IAgentRun {
    if (record.agent === null) {
      throw new HttpError(409, `run ${record.id} is not an agent check`);
    }
    return record.agent;
  }

  // The commit's skills and the store's; of two with one name the store's runs when it wins (the
  // skill store), else the repo's. A stored skill runs the version of the environment's
  // skill_channel. None when the commit has no shared contract to run them by.
  private async skillsOf(source: IRunSource, env: string): Promise<ISkill[]> {
    const repo = await readRepoSkills(this.workspace, source);
    if (repo === null) {
      return [];
    }
    const stored = this.store.list();
    const repoNames = new Set(repo.map((skill) => skill.name));
    const storedNames = new Set(stored.map((skill) => skill.name));
    const channel = buildEnvironment(env).skillChannel;
    const template = skillTemplate();
    return [
      ...repo
        .filter((skill) => !(this.store.wins && storedNames.has(skill.name)))
        .map(
          (skill): ISkill => ({
            name: skill.name,
            description: descriptionOf(skill.skillMd),
            unavailable: unavailableReason(skill.skillMd, skill.files),
            origin: "repo",
            version: null,
          })
        ),
      ...stored
        .filter((skill) => this.store.wins || !repoNames.has(skill.name))
        .map((skill) => this.storedSkill(skill, channel, template)),
    ];
  }

  // A stored skill as the environment's channel has it: the newest version, or the one promoted to
  // prod (none yet: not offered there).
  private storedSkill(
    stored: IStoredSkill,
    channel: ISkillChannel,
    template: string
  ): ISkill {
    const version = versionOn(channel, stored);
    const yaml =
      version === null ? null : this.store.yamlOf(stored.name, version);
    if (version === null || yaml === null) {
      return {
        name: stored.name,
        description: "",
        unavailable:
          "has no version promoted to prod yet: an operator promotes one (its page → Promote to prod)",
        origin: "console",
        version: null,
      };
    }
    const read = parseSkillSource(stored.name, yaml, template);
    return {
      name: stored.name,
      description: read.skill?.description ?? "",
      unavailable:
        read.skillMd === null
          ? "no longer reads as a skill: give it a new version"
          : unavailableReason(read.skillMd, []),
      origin: "console",
      version,
    };
  }

  // A stored skill's SKILL.md (the version the check was planned with) in a folder of the run's,
  // which the check links into Hermes's skills: never the working tree or the run's snapshot.
  private placeStoredSkill(agent: IAgentRun, runId: string): string {
    const yaml =
      agent.skillVersion === null
        ? null
        : this.store.yamlOf(agent.skill, agent.skillVersion);
    if (yaml === null) {
      throw new Error(
        `version ${agent.skillVersion ?? "?"} of ${
          agent.skill
        } is not in this console`
      );
    }
    const read = parseSkillSource(agent.skill, yaml, skillTemplate());
    if (read.skillMd === null) {
      throw new Error(
        `${agent.skill} v${
          agent.skillVersion ?? "?"
        } no longer reads as a skill: ${read.problems[0]?.message ?? "?"}`
      );
    }
    const folder = path.join(
      runDirectory(runId),
      STORED_SKILL_DIR,
      agent.skill
    );
    fs.mkdirSync(folder, { recursive: true, mode: 0o755 });
    fs.writeFileSync(path.join(folder, SKILL_FILE), read.skillMd, {
      mode: 0o644,
    });
    return folder;
  }

  private usageOf(id: string): IAgentRun["usage"] {
    try {
      const parsed = agentUsageSchema.safeParse(
        JSON.parse(fs.readFileSync(runFile(id, "agent-usage.json"), "utf8"))
      );
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  // In the background, as the environment's runner: the run is over either way.
  private asRunner(
    env: string,
    hermesHome: string,
    program: string,
    args: string[],
    then: () => void = () => undefined
  ): void {
    const command = this.runners.command(env, program, args);
    execFile(
      command.program,
      command.args,
      {
        env: {
          PATH: process.env.PATH ?? "",
          ...this.runners.variables(env),
          HOME: path.dirname(hermesHome),
          HERMES_HOME: hermesHome,
        },
        timeout: RUNNER_COMMAND_MS,
      },
      () => then()
    );
  }
}
