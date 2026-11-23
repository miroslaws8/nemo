import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import type { ILiveEventPayload } from "../../../engine/types/index.ts";
import type { IAgentUsage } from "../../shared/types.ts";
import type { IAgentRunConfig } from "../types.ts";

// One agent check (docs/guide.md → QA Console → Agent checks): Hermes Agent runs one of nemo's
// skills against an environment, and this tells the console how it goes, as a run of one test.
// The console starts it as the environment's runner, in the run's tests, with <run dir>/agent.json
// (agents/agent-runs.ts) and the model key in its provider's variable (config.keyVariable). It
//   - keeps the key in the Hermes home's .env while the check runs (Hermes reads it there);
//   - links the commit's skills into the Hermes home and writes its config.yaml;
//   - puts the QA account into Hermes's vault once (the browser fills the password there; the
//     agent never sees it, and Hermes never gets the account's variables);
//   - runs `hermes chat` with the skill and turns its stream-json into the run's live events:
//     each tool call a step, each new screenshot the live shot, its answer the log;
//   - on SIGINT or SIGTERM (Stop) stops Hermes's gateway, which ends the chat;
//   - at the end keeps the screenshots, exports the transcript as the run's report and reads the
//     verdict (RESULT: PASS | FAIL) and the tokens spent (<run dir>/agent-usage.json).
// Node runs this file directly (no npm packages): keep its imports type-only.

const TEST_ID = "agent";
// Where the skills save their screenshots (hermes/qa-shared.md → Screenshots), under HOME.
const SCREENSHOTS_FOLDER = "nemo-output";
// Which QA account the vault holds, by login origin (a salted hash: no password).
const VAULT_MARKER = "qa-console-vault.json";
const TITLE_LENGTH = 140;
const ERROR_LENGTH = 2000;
// What every skill uses beside its SKILL.md, from hermes/: the shared contract and the helper
// that marks the page for screenshots.
const SHARED_FILES = ["qa-shared.md", "qa-mark.js"];
const HERMES_COMMAND_MS = 60_000;
// Hermes ends a check at its run budget; past this much more the check is stopped.
const BUDGET_GRACE_SECONDS = 120;
const RESULT_LINE = /RESULT:\s*(PASS|FAIL)\b[^\n]*/;
// What Hermes gets of this process's environment (never the QA account or the console's own).
const HERMES_VARIABLES = [
  "PATH",
  "USER",
  "LOGNAME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "TMPDIR",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
];

type IEnding = "passed" | "failed" | "interrupted" | "timedout";

const TEST_ENDINGS: Record<
  IEnding,
  {
    status: "passed" | "failed" | "interrupted" | "timedOut";
    outcome: "expected" | "unexpected" | "skipped";
    exitCode: number;
  }
> = {
  passed: { status: "passed", outcome: "expected", exitCode: 0 },
  failed: { status: "failed", outcome: "unexpected", exitCode: 1 },
  interrupted: { status: "interrupted", outcome: "skipped", exitCode: 130 },
  timedout: { status: "timedOut", outcome: "unexpected", exitCode: 1 },
};

interface ITokens {
  uncached: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

interface IChatResult {
  sessionId: string | null;
  exitCode: number | null;
  text: string;
  tokens: ITokens | null;
}

interface IVaultEntry {
  handle: string;
  salt: string;
  fingerprint: string;
}

interface IOpenStep {
  stepId: string;
  tool: string;
  startedAt: number;
}

// How a tool's result ends its step: failed (error), or done with a note.
interface IStepOutcome {
  error: string | null;
  note: string | null;
}

type IRecord = Record<string, unknown>;

function isRecord(value: unknown): value is IRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function shorten(text: string, length: number): string {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length <= length ? single : `${single.slice(0, length - 1)}…`;
}

function firstLine(text: string): string {
  return text.split("\n").find((line) => line.trim() !== "") ?? "";
}

// browser_exec code starts with a "# what this does" comment (the skills ask for one).
function browserTitle(input: IRecord): string {
  const line = firstLine(textOf(input.code)).trim();
  return line.startsWith("#")
    ? line.replace(/^#+\s*/, "")
    : `Run in the browser: ${line}`;
}

function listOf(value: unknown): string {
  const items = Array.isArray(value) ? value : [value];
  return items.filter((item) => typeof item === "string").join(", ");
}

const VAULT_TITLES: Record<string, string> = {
  list: "Look up the saved login",
  fill: "Fill the password from the vault",
};

// tool_call runs other tools (Hermes loads some only when asked): their titles.
function bridgedTitle(input: IRecord): string {
  const calls = Array.isArray(input.calls) ? input.calls : [input];
  return calls
    .map((call) =>
      isRecord(call) ? stepTitle(textOf(call.name), call.arguments) : ""
    )
    .filter((title) => title !== "")
    .join("; ");
}

// A step's title by the tool it calls (what the agent does, in words); any other tool: its name
// and input.
const STEP_TITLES: Record<string, (input: IRecord) => string> = {
  browser_exec: browserTitle,
  terminal: (input) => `$ ${firstLine(textOf(input.command))}`,
  browser_vault: (input) =>
    VAULT_TITLES[textOf(input.action)] ?? `Vault: ${textOf(input.action)}`,
  vision_analyze: (input) =>
    `Look at ${path.basename(textOf(input.image_url))}: ${firstLine(
      textOf(input.question)
    )}`,
  tool_call: bridgedTitle,
  tool_search: (input) => `Look for a tool: ${listOf(input.queries)}`,
  tool_describe: (input) => `Read how to use ${listOf(input.names)}`,
  skill_view: (input) => `Read the skill ${textOf(input.name)}`,
  skills_list: () => "List the skills",
  todo: () => "Update its to-do list",
  read_file: (input) => `Read ${textOf(input.path)}`,
  write_file: (input) => `Write ${textOf(input.path)}`,
  search_files: (input) => `Search the files for ${textOf(input.pattern)}`,
};

// By default a result Hermes marks as an error fails its step.
function toolOutcome(event: IRecord): IStepOutcome {
  return event.is_error === true
    ? { error: shorten(textOf(event.output), ERROR_LENGTH), note: null }
    : { error: null, note: null };
}

// The terminal's own result: {"output": …, "exit_code": …, "error": …}.
const COMMAND_RESULT = /^\{\s*"output"\s*:/;

function recordOf(text: string): IRecord | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// A command that ran and exited non-zero (an `ls` of a folder not made yet, a grep with no match)
// is output for the agent to read, not a failed step; the terminal saying it could not run it (its
// `error`) is one. A long output reaches the stream cut short, without its exit code.
function commandOutcome(event: IRecord): IStepOutcome {
  const output = textOf(event.output);
  if (event.is_error !== true || !COMMAND_RESULT.test(output)) {
    return toolOutcome(event);
  }
  const result = recordOf(output);
  if (typeof result?.error === "string" && result.error !== "") {
    return { error: shorten(result.error, ERROR_LENGTH), note: null };
  }
  return {
    error: null,
    note:
      typeof result?.exit_code === "number"
        ? `exit ${result.exit_code}`
        : "non-zero exit",
  };
}

// Tools whose results end their steps a way of their own.
const TOOL_OUTCOMES: Record<string, (event: IRecord) => IStepOutcome> = {
  terminal: commandOutcome,
};

function stepTitle(name: string, input: unknown): string {
  const record = isRecord(input) ? input : {};
  const title = STEP_TITLES[name];
  return shorten(
    title === undefined ? `${name} ${JSON.stringify(record)}` : title(record),
    TITLE_LENGTH
  );
}

// The stream's result counts cache reads and writes inside its input tokens.
function tokensOfResult(value: unknown): ITokens | null {
  if (!isRecord(value)) {
    return null;
  }
  const cacheRead = numberOf(value.cache_read);
  const cacheWrite = numberOf(value.cache_write);
  return {
    uncached: Math.max(0, numberOf(value.input) - cacheRead - cacheWrite),
    output: numberOf(value.output),
    cacheRead,
    cacheWrite,
  };
}

// A session's export counts them apart (and keeps them when the chat was stopped).
function tokensOfSession(value: unknown): ITokens | null {
  if (!isRecord(value) || typeof value.input_tokens !== "number") {
    return null;
  }
  return {
    uncached: numberOf(value.input_tokens),
    output: numberOf(value.output_tokens),
    cacheRead: numberOf(value.cache_read_tokens),
    cacheWrite: numberOf(value.cache_write_tokens),
  };
}

// The tokens as the provider bills them: one with no cache writes bills them as new input.
function billed(tokens: ITokens, cacheWrites: boolean): ITokens {
  return cacheWrites
    ? tokens
    : {
        ...tokens,
        uncached: tokens.uncached + tokens.cacheWrite,
        cacheWrite: 0,
      };
}

// Each kind of token is priced on its own; none counted: nothing known (null).
function usageOf(
  tokens: ITokens,
  prices: IAgentRunConfig["usdPerMillion"]
): IAgentUsage | null {
  const input = tokens.uncached + tokens.cacheRead + tokens.cacheWrite;
  if (input + tokens.output === 0) {
    return null;
  }
  const dollars =
    (tokens.uncached * prices.input +
      tokens.cacheRead * prices.cacheRead +
      tokens.cacheWrite * prices.cacheWrite +
      tokens.output * prices.output) /
    1_000_000;
  return {
    inputTokens: input,
    outputTokens: tokens.output,
    cacheReadTokens: tokens.cacheRead,
    cacheWriteTokens: tokens.cacheWrite,
    estimatedUsd: Math.round(dollars * 10_000) / 10_000,
  };
}

const CONFIG_TEXTS = [
  "runId",
  "runDir",
  "env",
  "skill",
  "arguments",
  "model",
  "provider",
  "keyVariable",
  "dataPrefix",
  "hermes",
  "home",
  "hermesHome",
  "hermesSource",
  "windowSize",
] as const;
const CONFIG_NUMBERS = ["maxTurns", "runBudgetSeconds"] as const;
const PRICES = ["input", "output", "cacheRead", "cacheWrite"] as const;

function isLogin(value: unknown): value is IAgentRunConfig["login"] {
  return (
    value === null ||
    (isRecord(value) &&
      typeof value.origin === "string" &&
      typeof value.identifierVariable === "string" &&
      typeof value.passwordVariable === "string")
  );
}

/** What the console wrote (agents/agent-runs.ts). */
function isAgentRunConfig(value: unknown): value is IAgentRunConfig {
  if (!isRecord(value)) {
    return false;
  }
  const { toolsets, baseUrl, usdPerMillion } = value;
  return (
    CONFIG_TEXTS.every((key) => typeof value[key] === "string") &&
    CONFIG_NUMBERS.every((key) => typeof value[key] === "number") &&
    Array.isArray(toolsets) &&
    toolsets.every((toolset) => typeof toolset === "string") &&
    isRecord(baseUrl) &&
    typeof baseUrl.variable === "string" &&
    typeof baseUrl.url === "string" &&
    typeof value.cacheWrites === "boolean" &&
    (value.storedSkill === null || typeof value.storedSkill === "string") &&
    isRecord(usdPerMillion) &&
    PRICES.every((key) => typeof usdPerMillion[key] === "number") &&
    isLogin(value.login)
  );
}

function readConfig(file: string | undefined): IAgentRunConfig {
  if (file === undefined) {
    throw new Error("usage: node agent-run.mts <run dir>/agent.json");
  }
  const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!isAgentRunConfig(parsed)) {
    throw new Error(`${file} is not an agent check's config`);
  }
  return parsed;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** The pngs under a folder, by their path relative to it. */
function screenshotsIn(folder: string): string[] {
  if (!fs.existsSync(folder)) {
    return [];
  }
  return fs
    .readdirSync(folder, { recursive: true, encoding: "utf8" })
    .filter((name) => name.toLowerCase().endsWith(".png"))
    .sort();
}

/** <run dir>/events.ndjson, as the live reporter writes it (engine/reporters/live-events.ts). */
class LiveEvents {
  private readonly file: string;
  private seq = 0;

  constructor(file: string) {
    this.file = file;
  }

  emit(event: ILiveEventPayload): void {
    const line = { seq: this.seq, ts: new Date().toISOString(), ...event };
    this.seq += 1;
    fs.appendFileSync(this.file, `${JSON.stringify(line)}\n`);
  }
}

class AgentCheck {
  private readonly config: IAgentRunConfig;
  private readonly events: LiveEvents;
  private readonly hermesEnvironment: NodeJS.ProcessEnv;
  private readonly screenshotsDir: string;
  private readonly openSteps = new Map<string, IOpenStep>();
  // Screenshot → its modification time when last shown.
  private readonly shown = new Map<string, number>();
  private stepCount = 0;
  private shotCount = 0;
  private stopReason: "interrupted" | "timedout" | null = null;
  // The model key and the password, blanked out of anything Hermes prints.
  private readonly secrets: string[] = [];
  private readonly keyFile: string;

  constructor(config: IAgentRunConfig, events: LiveEvents) {
    this.config = config;
    this.events = events;
    this.screenshotsDir = path.join(config.home, SCREENSHOTS_FOLDER);
    this.keyFile = path.join(config.hermesHome, ".env");
    this.hermesEnvironment = {
      ...Object.fromEntries(
        HERMES_VARIABLES.flatMap((key) => {
          const value = process.env[key];
          return value === undefined ? [] : [[key, value]];
        })
      ),
      HOME: config.home,
      HERMES_HOME: config.hermesHome,
      [config.baseUrl.variable]: config.baseUrl.url,
      // What the titles of the data the skill creates start with (hermes/qa-shared.md).
      QA_DATA_PREFIX: config.dataPrefix,
    };
  }

  /** Stop (the console's Stop, or past the budget): Hermes's gateway ends the chat. */
  stop(reason: "interrupted" | "timedout"): void {
    if (this.stopReason !== null) {
      return;
    }
    this.stopReason = reason;
    console.log(
      reason === "interrupted"
        ? "\n■ Stopped: stopping Hermes"
        : `\n■ Over the run budget (${this.config.runBudgetSeconds} s): stopping Hermes`
    );
    this.stopGateway();
  }

  async run(): Promise<number> {
    const started = Date.now();
    const { config } = this;
    this.events.emit({
      type: "run.begin",
      runId: config.runId,
      env: config.env,
      profile: "agent",
      workers: 1,
      tests: [
        {
          testId: TEST_ID,
          project: "agent",
          spec: "",
          file: null,
          suite: "Agent check",
          title: [`/${config.skill}`, config.env, config.arguments]
            .filter((part) => part !== "")
            .join(" "),
          tags: ["agent"],
        },
      ],
    });
    this.events.emit({
      type: "test.begin",
      testId: TEST_ID,
      retry: 0,
      lane: 0,
    });
    const budget = setTimeout(
      () => this.stop("timedout"),
      (config.runBudgetSeconds + BUDGET_GRACE_SECONDS) * 1000
    );

    let chat: IChatResult = {
      sessionId: null,
      exitCode: null,
      text: "",
      tokens: null,
    };
    const errors: string[] = [];
    try {
      this.inStep(
        "Prepare Hermes: skills, config, the QA account's login",
        () => this.prepare()
      );
      chat = await this.chat();
    } catch (error) {
      errors.push(this.blank(messageOf(error)));
    }
    clearTimeout(budget);
    // Nothing of the check stays behind: no gateway, no browser, no key.
    this.stopGateway();
    fs.rmSync(this.keyFile, { force: true });

    const ending = this.endingOf(chat, errors);
    const attachments = this.keepFiles();
    this.exportTranscript(chat, errors);
    const tokens = this.sessionTokens(chat) ?? chat.tokens;
    const usage =
      tokens === null
        ? null
        : usageOf(billed(tokens, config.cacheWrites), config.usdPerMillion);
    if (usage !== null) {
      fs.writeFileSync(
        path.join(config.runDir, "agent-usage.json"),
        `${JSON.stringify(usage)}\n`
      );
    }
    const test = TEST_ENDINGS[ending];
    this.events.emit({
      type: "test.end",
      testId: TEST_ID,
      retry: 0,
      status: test.status,
      outcome: test.outcome,
      ms: Date.now() - started,
      errors: errors.map((message) => ({ message, yaml: null })),
      annotations: [
        {
          type: "Agent report",
          description: chat.text.trim() === "" ? null : chat.text.trim(),
        },
      ],
      attachments,
    });
    this.events.emit({
      type: "run.end",
      status: ending,
      ms: Date.now() - started,
    });
    return test.exitCode;
  }

  private endingOf(chat: IChatResult, errors: string[]): IEnding {
    if (this.stopReason !== null) {
      return this.stopReason;
    }
    if (errors.length > 0) {
      return "failed";
    }
    const verdict = RESULT_LINE.exec(chat.text);
    if (chat.exitCode !== 0) {
      errors.push(
        `Hermes ended with exit code ${chat.exitCode ?? "?"} (its log has why)`
      );
      return "failed";
    }
    if (verdict === null) {
      errors.push(
        "The agent ended without a RESULT: PASS or RESULT: FAIL line"
      );
      return "failed";
    }
    if (verdict[1] === "FAIL") {
      errors.push(shorten(verdict[0], ERROR_LENGTH));
      return "failed";
    }
    return "passed";
  }

  private inStep(title: string, work: () => void): void {
    const stepId = this.beginStep(title, "setup");
    const started = Date.now();
    try {
      work();
    } catch (error) {
      this.endStep(stepId, Date.now() - started, this.blank(messageOf(error)));
      throw error;
    }
    this.endStep(stepId, Date.now() - started, null);
  }

  private beginStep(title: string, kind: "setup" | "other"): string {
    this.stepCount += 1;
    const stepId = `s${this.stepCount}`;
    this.events.emit({
      type: "step.begin",
      testId: TEST_ID,
      retry: 0,
      stepId,
      parentId: null,
      title,
      kind,
      yaml: null,
    });
    console.log(`\n▸ ${title}`);
    return stepId;
  }

  private endStep(
    stepId: string,
    ms: number,
    error: string | null,
    note: string | null = null
  ): void {
    this.events.emit({
      type: "step.end",
      testId: TEST_ID,
      retry: 0,
      stepId,
      ms,
      error,
      note,
    });
    if (error !== null) {
      console.log(`  ✗ ${shorten(error, 400)}`);
    } else if (note !== null) {
      console.log(`  (${note})`);
    }
  }

  private prepare(): void {
    const { config } = this;
    // The Hermes home is this runner's alone: its gateway refuses one anybody else may write.
    fs.mkdirSync(config.hermesHome, { recursive: true, mode: 0o700 });
    try {
      fs.chmodSync(config.hermesHome, 0o700);
    } catch {
      throw new Error(
        `${config.hermesHome} is not this runner's (${
          os.userInfo().username
        }): remove it and start the check again`
      );
    }
    // The model key, for this check only (removed when it ends).
    const key = process.env[config.keyVariable] ?? "";
    if (key === "" || !/^[A-Z][A-Z0-9_]*$/.test(config.keyVariable)) {
      throw new Error("the console handed over no model key");
    }
    this.secrets.push(key);
    fs.writeFileSync(this.keyFile, `${config.keyVariable}=${key}\n`, {
      mode: 0o600,
    });
    fs.chmodSync(this.keyFile, 0o600);
    const skillsDir = path.join(config.hermesHome, "skills");
    fs.mkdirSync(skillsDir, { recursive: true });
    // The commit's skills replace the last check's links (Hermes's own skills are folders).
    for (const name of fs.readdirSync(skillsDir)) {
      const entry = path.join(skillsDir, name);
      if (fs.lstatSync(entry).isSymbolicLink()) {
        fs.unlinkSync(entry);
      }
    }
    const source = path.join(config.hermesSource, "skills");
    for (const name of fs.readdirSync(source)) {
      if (fs.statSync(path.join(source, name)).isDirectory()) {
        fs.symlinkSync(path.join(source, name), path.join(skillsDir, name));
      }
    }
    // A skill from the console's store: in place of the commit's of that name.
    if (config.storedSkill !== null) {
      const link = path.join(skillsDir, config.skill);
      if (fs.lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink()) {
        fs.unlinkSync(link);
      }
      fs.symlinkSync(config.storedSkill, link);
    }
    for (const name of SHARED_FILES) {
      const link = path.join(config.hermesHome, name);
      // The last check's link points into its snapshot, gone by now: the link itself goes.
      if (fs.lstatSync(link, { throwIfNoEntry: false }) !== undefined) {
        fs.unlinkSync(link);
      }
      // An older commit may not have it yet.
      const source = path.join(config.hermesSource, name);
      if (fs.existsSync(source)) {
        fs.symlinkSync(source, link);
      }
    }
    // JSON is YAML too.
    const settings = {
      model: { provider: config.provider, default: config.model },
      toolsets: config.toolsets,
      agent: {
        max_turns: config.maxTurns,
        run_budget_seconds: config.runBudgetSeconds,
      },
      browser: {
        executable_path: chromiumPath(),
        // Linux (the server console's container): no sandbox to start Chromium in as a runner, and
        // Hermes adds --no-sandbox only where it sees Docker, never to an executable_path. The
        // tests' Chromium (Playwright) runs without one too.
        chromium_args: [
          `--window-size=${config.windowSize}`,
          ...(process.platform === "linux" ? ["--no-sandbox"] : []),
        ],
      },
      // Nothing waits for a person: what would need an approval is refused.
      approvals: {
        mode: "manual",
        single_query_mode: "deny",
        unattended_mode: "deny",
      },
    };
    fs.writeFileSync(
      path.join(config.hermesHome, "config.yaml"),
      `${JSON.stringify(settings, null, 2)}\n`
    );
    // This check's screenshots only.
    fs.rmSync(this.screenshotsDir, { recursive: true, force: true });
    fs.mkdirSync(this.screenshotsDir, { recursive: true });
    this.seedVault();
  }

  // The QA account goes into the vault of this Hermes home once (again when it changes).
  private seedVault(): void {
    const { login, env } = this.config;
    if (login === null) {
      console.log(
        `  ${env} names no login_origin (e2e.config.yaml): the vault stays as it is`
      );
      return;
    }
    const identifier = process.env[login.identifierVariable] ?? "";
    const password = process.env[login.passwordVariable] ?? "";
    if (identifier === "" || password === "") {
      throw new Error(
        `${login.identifierVariable} and ${login.passwordVariable} are not set: the console has no QA account for ${env}`
      );
    }
    this.secrets.push(password);
    const markerFile = path.join(this.config.hermesHome, VAULT_MARKER);
    const marker = readMarker(markerFile);
    const kept = marker[login.origin];
    if (
      kept !== undefined &&
      fingerprint(kept.salt, identifier, password) === kept.fingerprint
    ) {
      console.log(`  the vault holds the QA account for ${login.origin}`);
      return;
    }
    if (kept !== undefined) {
      this.hermes(["vault", "rm", kept.handle], null);
    }
    const answers = [
      `${env} QA account (QA console)`,
      login.origin,
      "email",
      identifier,
      password,
      // No authenticator key.
      "",
    ];
    const added = this.hermes(
      ["vault", "add", "--kind", "login"],
      `${answers.join("\n")}\n`
    );
    const handle = /Stored\. handle=(\S+)/.exec(added.stdout)?.[1];
    if (added.status !== 0 || handle === undefined) {
      throw new Error(
        `Hermes did not store the QA account's login: ${shorten(
          this.blank(`${added.stdout} ${added.stderr}`),
          ERROR_LENGTH
        )}`
      );
    }
    const salt = crypto.randomBytes(16).toString("hex");
    marker[login.origin] = {
      handle,
      salt,
      fingerprint: fingerprint(salt, identifier, password),
    };
    fs.writeFileSync(markerFile, `${JSON.stringify(marker)}\n`, {
      mode: 0o600,
    });
    console.log(`  the vault now holds the QA account for ${login.origin}`);
  }

  private hermes(
    args: string[],
    input: string | null
  ): { status: number | null; stdout: string; stderr: string } {
    const result = spawnSync(this.config.hermes, args, {
      env: this.hermesEnvironment,
      cwd: this.config.home,
      input: input ?? "",
      encoding: "utf8",
      timeout: HERMES_COMMAND_MS,
    });
    return {
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  }

  private stopGateway(): void {
    this.hermes(["gateway", "stop", "--yes"], null);
  }

  private blank(text: string): string {
    return this.secrets.reduce(
      (blanked, secret) => blanked.replaceAll(secret, "•••"),
      text
    );
  }

  // `hermes chat` with the skill; its stream-json becomes the run's events.
  private chat(): Promise<IChatResult> {
    const { config } = this;
    const result: IChatResult = {
      sessionId: null,
      exitCode: null,
      text: "",
      tokens: null,
    };
    // Stopped while it was being prepared.
    if (this.stopReason !== null) {
      return Promise.resolve(result);
    }
    const stream = fs.openSync(
      path.join(config.runDir, "artifacts", "agent-stream.ndjson"),
      "a"
    );
    const child = spawn(
      config.hermes,
      [
        "chat",
        "-q",
        [`/${config.skill}`, config.env, config.arguments]
          .filter((part) => part !== "")
          .join(" "),
        "-Q",
        "--format",
        "stream-json",
        "--provider",
        config.provider,
        "-m",
        config.model,
        "--max-turns",
        String(config.maxTurns),
        "-t",
        config.toolsets.join(","),
        "--ignore-rules",
      ],
      {
        env: this.hermesEnvironment,
        cwd: config.home,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    child.stderr.on("data", (chunk: Buffer) => {
      process.stderr.write(this.blank(chunk.toString("utf8")));
    });
    const lines = readline.createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      fs.writeSync(stream, `${line}\n`);
      this.onLine(line, result);
    });
    return new Promise((resolve, reject) => {
      child.on("error", (error) => {
        fs.closeSync(stream);
        reject(
          new Error(`hermes did not start (${config.hermes}): ${error.message}`)
        );
      });
      child.on("close", (code) => {
        fs.closeSync(stream);
        result.exitCode = result.exitCode ?? code;
        // Steps Hermes never answered (stopped in the middle).
        for (const open of this.openSteps.values()) {
          this.endStep(
            open.stepId,
            Date.now() - open.startedAt,
            "no answer: the chat ended"
          );
        }
        this.openSteps.clear();
        resolve(result);
      });
    });
  }

  private onLine(line: string, result: IChatResult): void {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      console.log(line);
      return;
    }
    if (!isRecord(event)) {
      return;
    }
    const handle = this.handlers[textOf(event.type)];
    handle?.(event, result);
  }

  // What each kind of Hermes stream event does; others are only kept in agent-stream.ndjson.
  private readonly handlers: Record<
    string,
    (event: IRecord, result: IChatResult) => void
  > = {
    system: (event) => {
      console.log(`Hermes: ${textOf(event.subtype)} on ${textOf(event.model)}`);
    },
    tool_use: (event) => {
      const stepId = this.beginStep(
        stepTitle(textOf(event.name), event.input),
        "other"
      );
      this.openSteps.set(textOf(event.tool_call_id), {
        stepId,
        tool: textOf(event.name),
        startedAt: Date.now(),
      });
    },
    tool_result: (event) => {
      const callId = textOf(event.tool_call_id);
      const open = this.openSteps.get(callId);
      if (open === undefined) {
        return;
      }
      this.openSteps.delete(callId);
      const outcome = (TOOL_OUTCOMES[open.tool] ?? toolOutcome)(event);
      this.endStep(
        open.stepId,
        numberOf(event.duration_ms) || Date.now() - open.startedAt,
        outcome.error,
        outcome.note
      );
      this.showScreenshots(open.stepId);
    },
    result: (event, result) => {
      result.sessionId = textOf(event.session_id) || null;
      result.exitCode =
        typeof event.exit_code === "number" ? event.exit_code : null;
      result.text = textOf(event.text);
      result.tokens = tokensOfResult(event.tokens);
      // The whole answer (its streamed chunks lose line breaks).
      console.log(`\n${result.text.trim()}`);
    },
  };

  // Screenshots the step saved (new or changed): the run's live shot is the newest.
  private showScreenshots(stepId: string): void {
    const shots = path.join(this.config.runDir, "shots");
    for (const name of screenshotsIn(this.screenshotsDir)) {
      const file = path.join(this.screenshotsDir, name);
      const modified = fs.statSync(file).mtimeMs;
      if (this.shown.get(name) === modified) {
        continue;
      }
      this.shown.set(name, modified);
      this.shotCount += 1;
      const target = `${this.shotCount}-${path.basename(name)}`;
      fs.mkdirSync(shots, { recursive: true });
      fs.copyFileSync(file, path.join(shots, target));
      this.events.emit({
        type: "step.shot",
        testId: TEST_ID,
        retry: 0,
        stepId,
        path: `shots/${target}`,
      });
    }
  }

  // The screenshots as the run's attachments, beside the raw stream and the SKILL.md Hermes read.
  private keepFiles(): { name: string; path: string }[] {
    const kept = screenshotsIn(this.screenshotsDir).map((name) => {
      const relative = path.join("artifacts", "screenshots", name);
      const target = path.join(this.config.runDir, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(this.screenshotsDir, name), target);
      return { name: path.basename(name), path: relative };
    });
    return [
      ...kept,
      ...this.keepSkillFile(),
      {
        name: "Hermes stream",
        path: path.join("artifacts", "agent-stream.ndjson"),
      },
    ];
  }

  // What the agent was told: the skill's SKILL.md as linked into its Hermes home.
  private keepSkillFile(): { name: string; path: string }[] {
    const relative = path.join("artifacts", "SKILL.md");
    try {
      fs.copyFileSync(
        path.join(
          this.config.hermesSource,
          "skills",
          this.config.skill,
          "SKILL.md"
        ),
        path.join(this.config.runDir, relative)
      );
      return [{ name: "SKILL.md", path: relative }];
    } catch {
      return [];
    }
  }

  // What the session spent, as Hermes keeps it (<run dir>/agent-session.jsonl).
  private sessionTokens(chat: IChatResult): ITokens | null {
    if (chat.sessionId === null) {
      return null;
    }
    const file = path.join(this.config.runDir, "agent-session.jsonl");
    const exported = this.hermes(
      [
        "sessions",
        "export",
        file,
        "--session-id",
        chat.sessionId,
        "--format",
        "jsonl",
      ],
      null
    );
    if (exported.status !== 0 || !fs.existsSync(file)) {
      return null;
    }
    try {
      return tokensOfSession(
        JSON.parse(firstLine(fs.readFileSync(file, "utf8")))
      );
    } catch {
      return null;
    }
  }

  // The chat's transcript is the run's report (html/index.html).
  private exportTranscript(chat: IChatResult, errors: string[]): void {
    const html = path.join(this.config.runDir, "html");
    fs.mkdirSync(html, { recursive: true });
    const page = path.join(html, "index.html");
    if (chat.sessionId !== null) {
      const exported = this.hermes(
        [
          "sessions",
          "export",
          page,
          "--session-id",
          chat.sessionId,
          "--format",
          "html",
        ],
        null
      );
      if (exported.status === 0 && fs.existsSync(page)) {
        return;
      }
      errors.push("Hermes did not export the chat's transcript");
    }
    fs.writeFileSync(
      page,
      `<!doctype html><meta charset="utf-8"><title>Agent check ${escapeHtml(
        this.config.runId
      )}</title><p>No transcript: the chat did not start or Hermes did not export it. The run's log has what happened.</p>`
    );
  }
}

function fingerprint(
  salt: string,
  identifier: string,
  password: string
): string {
  return crypto
    .createHash("sha256")
    .update(`${salt}\0${identifier}\0${password}`)
    .digest("hex");
}

function readMarker(file: string): Record<string, IVaultEntry> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
  if (!isRecord(parsed)) {
    return {};
  }
  const entries: Record<string, IVaultEntry> = {};
  for (const [origin, entry] of Object.entries(parsed)) {
    if (
      isRecord(entry) &&
      typeof entry.handle === "string" &&
      typeof entry.salt === "string" &&
      typeof entry.fingerprint === "string"
    ) {
      entries[origin] = {
        handle: entry.handle,
        salt: entry.salt,
        fingerprint: entry.fingerprint,
      };
    }
  }
  return entries;
}

// The Chromium of the run's Playwright (its browsers, PLAYWRIGHT_BROWSERS_PATH): Hermes drives it.
// playwright-core is found the way the run's @playwright/test finds it (through playwright): pnpm
// keeps it out of the top node_modules.
function chromiumPath(): string {
  const fromRun = createRequire(path.join(process.cwd(), "package.json"));
  const fromTest = createRequire(fromRun.resolve("@playwright/test"));
  const fromPlaywright = createRequire(fromTest.resolve("playwright"));
  const playwright: unknown = fromPlaywright("playwright-core");
  if (
    isRecord(playwright) &&
    isRecord(playwright.chromium) &&
    typeof playwright.chromium.executablePath === "function"
  ) {
    const found: unknown = playwright.chromium.executablePath();
    if (typeof found === "string" && fs.existsSync(found)) {
      return found;
    }
  }
  throw new Error(
    "Playwright's Chromium is not installed for these tests (pnpm exec playwright install chromium)"
  );
}

async function main(): Promise<number> {
  const config = readConfig(process.argv[2]);
  fs.mkdirSync(path.join(config.runDir, "artifacts"), { recursive: true });
  const check = new AgentCheck(
    config,
    new LiveEvents(path.join(config.runDir, "events.ndjson"))
  );
  process.on("SIGINT", () => check.stop("interrupted"));
  process.on("SIGTERM", () => check.stop("interrupted"));
  return check.run();
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`✗ The agent check did not run: ${messageOf(error)}`);
    process.exit(1);
  }
);
