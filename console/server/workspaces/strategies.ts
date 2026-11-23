import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { buildEnvironment } from "../../../engine/environment";
import { E2E_ROOT } from "../../../engine/paths";
import { resolveRun } from "../../../engine/run-selection";
import type {
  IBranch,
  ICatalogTest,
  IRunRecord,
  IRunSource,
} from "../../shared/types";
import { listTests } from "../catalog";
import { HttpError } from "../http-error";
import { PLAYWRIGHT_CLI } from "../settings";
import type {
  ICommandLine,
  IConsoleMode,
  IConsoleSettings,
  IGitSettings,
  IPreparedRun,
  IRunners,
  IWorkspace,
} from "../types";
import { BrowserCache, type IBrowsers } from "./browsers";
import { DepsCache } from "./deps-cache";
import { GitRepo } from "./git-repo";
import { runnerEnvironment } from "./runner-env";
import { makeSnapshot, removeSnapshot } from "./snapshots";

// Where a console's tests come from (IWorkspace), by its mode:
//   local  — the working tree the console runs in, as it is now;
//   server — a snapshot of the commit each run was started on: its environment's branch (or the
//            one asked for) at that moment, kept by a pin until the run's folder goes.

// The working tree lists a profile again after a minute; a commit's listing never changes.
const WORKING_TREE_LISTING_MS = 60_000;
const COMMIT_LISTINGS_KEPT = 50;
// What a run may be handed of the console's own environment where the tests are its own code.
const RUN_VARIABLES = ["E2E_RUN_DIR", "E2E_RUN_ID", "E2E_SKIP_NEEDS"];

const NO_SOURCE: IRunSource = { ref: null, sha: null };

const protocolSchema = z.object({ version: z.number().int() });
// Only what the console checks of a branch's e2e.config.yaml; the run validates the rest.
const branchConfigSchema = z.object({
  environments: z.record(z.string(), z.unknown()),
  profiles: z.record(z.string(), z.unknown()),
});

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function badRequest(error: unknown): HttpError {
  return new HttpError(400, messageOf(error));
}

function readJson<TSchema extends z.ZodType>(
  file: string,
  schema: TSchema
): z.infer<TSchema> {
  return schema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
}

// What this console reads: a commit must speak the same protocol (its Playwright may differ:
// browsers.ts installs the Chromium it takes).
const OWN_PROTOCOL = readJson(
  path.join(E2E_ROOT, "engine", "console-protocol.json"),
  protocolSchema
).version;

function cliIn(folder: string): string {
  return path.join(folder, "node_modules", "@playwright", "test", "cli.js");
}

// The working tree's Playwright, run by the console's own user.
function ownPlaywright(args: string[]): ICommandLine {
  return { program: process.execPath, args: [PLAYWRIGHT_CLI, ...args] };
}

// A commit's page on the hosts nemo may live on; null for any other.
const COMMIT_PAGES: {
  pattern: RegExp;
  page: (match: RegExpMatchArray) => string;
}[] = [
  {
    pattern: /bitbucket\.org[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/,
    page: (match) =>
      `https://bitbucket.org/${match[1]}/${match[2]}/commits/{sha}`,
  },
  {
    pattern: /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/,
    page: (match) => `https://github.com/${match[1]}/${match[2]}/commit/{sha}`,
  },
];

function commitPageOf(url: string): string | null {
  for (const host of COMMIT_PAGES) {
    const match = url.match(host.pattern);
    if (match !== null) {
      return host.page(match);
    }
  }
  return null;
}

/** The working tree this console runs in (a developer's machine). */
class WorkingTree implements IWorkspace {
  readonly testsFrom = "working-tree";
  private readonly listings = new Map<
    string,
    { at: number; tests: ICatalogTest[] }
  >();

  async resolve(
    env: string,
    profile: string | null,
    ref: string | null
  ): Promise<IRunSource> {
    if (ref !== null) {
      throw new HttpError(
        400,
        "this console runs its working tree: a branch takes a server console"
      );
    }
    try {
      if (profile === null) {
        buildEnvironment(env);
      } else {
        resolveRun(env, profile);
      }
    } catch (error) {
      throw badRequest(error);
    }
    return NO_SOURCE;
  }

  async retrySource(): Promise<IRunSource> {
    return NO_SOURCE;
  }

  async catalog(
    env: string,
    profile: string,
    _source: IRunSource,
    refresh: boolean
  ): Promise<ICatalogTest[]> {
    const key = `${env}|${profile}`;
    const kept = this.listings.get(key);
    if (
      !refresh &&
      kept !== undefined &&
      Date.now() - kept.at < WORKING_TREE_LISTING_MS
    ) {
      return kept.tests;
    }
    const tests = await listTests({
      cwd: E2E_ROOT,
      env: { ...this.ownEnvironment(), E2E_ENV: env, E2E_PROFILE: profile },
      playwright: ownPlaywright,
    });
    this.listings.set(key, { at: Date.now(), tests });
    return tests;
  }

  async pin(): Promise<void> {
    return;
  }

  async prepare(
    _record: IRunRecord,
    variables: Record<string, string>
  ): Promise<IPreparedRun> {
    return {
      cwd: E2E_ROOT,
      env: { ...this.ownEnvironment(), ...variables },
      playwright: ownPlaywright,
    };
  }

  release(): void {
    return;
  }

  async readFile(
    _source: IRunSource | null,
    file: string
  ): Promise<string | null> {
    try {
      return fs.readFileSync(path.join(E2E_ROOT, file), "utf8");
    } catch {
      return null;
    }
  }

  async listFolder(
    _source: IRunSource | null,
    folder: string
  ): Promise<string[]> {
    try {
      return fs.readdirSync(path.join(E2E_ROOT, folder));
    } catch {
      return [];
    }
  }

  async branches(): Promise<IBranch[]> {
    return [];
  }

  async forget(): Promise<void> {
    return;
  }

  toolVariables(): Record<string, string> {
    return {};
  }

  tidy(): void {
    return;
  }

  commitUrl(): string | null {
    return null;
  }

  // The tests are this machine's own code: they get the console's environment, less a run's.
  private ownEnvironment(): NodeJS.ProcessEnv {
    const environment: NodeJS.ProcessEnv = { ...process.env };
    for (const key of RUN_VARIABLES) {
      delete environment[key];
    }
    return environment;
  }
}

/** Snapshots of nemo's commits (a server console). */
class GitSnapshots implements IWorkspace {
  readonly testsFrom = "git";
  private readonly repo: GitRepo;
  private readonly deps: DepsCache;
  private readonly browsers: BrowserCache;
  private readonly workDir: string;
  private readonly authDir: string;
  private readonly page: string | null;
  // sha|env|profile → the listing (or the one going on).
  private readonly listings = new Map<string, Promise<ICatalogTest[]>>();
  // Commits already found fit for an environment and profile.
  private readonly checked = new Set<string>();
  // The package set and the browsers each prepared run uses.
  private readonly runDeps = new Map<string, string>();
  private readonly runBrowsers = new Map<string, IBrowsers>();

  constructor(
    settings: IConsoleSettings,
    git: IGitSettings,
    private readonly runners: IRunners
  ) {
    this.repo = new GitRepo(
      path.join(settings.dataDir, "git", "nemo.git"),
      git
    );
    this.deps = new DepsCache(
      path.join(settings.dataDir, "deps"),
      path.join(settings.dataDir, "pnpm-store")
    );
    this.browsers = new BrowserCache(path.join(settings.dataDir, "browsers"));
    this.workDir = path.join(settings.dataDir, "work");
    this.authDir = path.join(settings.dataDir, "auth");
    this.page = commitPageOf(git.url);
  }

  async resolve(
    env: string,
    profile: string | null,
    ref: string | null
  ): Promise<IRunSource> {
    let branch: string;
    try {
      branch = ref ?? buildEnvironment(env).branch;
    } catch (error) {
      throw badRequest(error);
    }
    const sha = await this.repo.branchHead(branch);
    await this.checkCommit(branch, sha, env, profile);
    return { ref: branch, sha };
  }

  async retrySource(parent: IRunRecord): Promise<IRunSource> {
    return parent.sha === null
      ? this.resolve(
          parent.env,
          parent.agent === null ? parent.profile : null,
          null
        )
      : { ref: parent.ref, sha: parent.sha };
  }

  async catalog(
    env: string,
    profile: string,
    source: IRunSource,
    refresh: boolean
  ): Promise<ICatalogTest[]> {
    const sha = this.shaOf(source);
    const key = `${sha}|${env}|${profile}`;
    const kept = this.listings.get(key);
    if (kept !== undefined && !refresh) {
      return kept;
    }
    const listing = this.list(sha, env, profile).catch((error: unknown) => {
      this.listings.delete(key);
      throw error;
    });
    this.listings.set(key, listing);
    for (const old of this.listings.keys()) {
      if (this.listings.size <= COMMIT_LISTINGS_KEPT) {
        break;
      }
      this.listings.delete(old);
    }
    return listing;
  }

  async pin(runId: string, source: IRunSource): Promise<void> {
    await this.repo.pin(runId, this.shaOf(source));
  }

  async prepare(
    record: IRunRecord,
    variables: Record<string, string>,
    signal: AbortSignal
  ): Promise<IPreparedRun> {
    const folder = path.join(this.workDir, record.id);
    removeSnapshot(folder);
    const depsKey = await this.snapshot(
      this.shaOf(record),
      folder,
      record.env,
      signal
    );
    this.runDeps.set(record.id, depsKey);
    const browsers = await this.browsers.acquire(
      path.join(folder, "node_modules"),
      signal
    );
    this.runBrowsers.set(record.id, browsers);
    return {
      cwd: folder,
      env: runnerEnvironment(record.env, {
        ...variables,
        ...this.runners.variables(record.env),
        E2E_AUTH_DIR: this.authDirOf(record.env),
        ...(browsers.path === null
          ? {}
          : { PLAYWRIGHT_BROWSERS_PATH: browsers.path }),
      }),
      playwright: (args) =>
        this.runners.node(record.env, [cliIn(folder), ...args]),
    };
  }

  release(runId: string): void {
    removeSnapshot(path.join(this.workDir, runId));
    const depsKey = this.runDeps.get(runId);
    if (depsKey !== undefined) {
      this.deps.release(depsKey);
      this.runDeps.delete(runId);
    }
    const browsers = this.runBrowsers.get(runId);
    if (browsers !== undefined) {
      this.browsers.release(browsers);
      this.runBrowsers.delete(runId);
    }
  }

  async readFile(
    source: IRunSource | null,
    file: string
  ): Promise<string | null> {
    return source === null || source.sha === null
      ? null
      : this.repo.show(source.sha, file);
  }

  async listFolder(
    source: IRunSource | null,
    folder: string
  ): Promise<string[]> {
    return source === null || source.sha === null
      ? []
      : this.repo.list(source.sha, folder);
  }

  branches(): Promise<IBranch[]> {
    return this.repo.branches();
  }

  async forget(runIds: string[]): Promise<void> {
    await this.repo.unpin(runIds);
  }

  toolVariables(): Record<string, string> {
    return { E2E_AUTH_DIR: this.authDir };
  }

  // Snapshots no run uses, half-done package sets and browsers (the console stopped in the middle).
  tidy(keep: ReadonlySet<string>): void {
    this.deps.tidy();
    this.browsers.tidy();
    if (!fs.existsSync(this.workDir)) {
      return;
    }
    for (const name of fs.readdirSync(this.workDir)) {
      if (!keep.has(name)) {
        removeSnapshot(path.join(this.workDir, name));
      }
    }
  }

  commitUrl(): string | null {
    return this.page;
  }

  private shaOf(source: IRunSource): string {
    if (source.sha === null) {
      throw new HttpError(409, "this run has no commit to test");
    }
    return source.sha;
  }

  // A commit fit to run here: it speaks this console's protocol and knows the environment and
  // the profile.
  private async checkCommit(
    branch: string,
    sha: string,
    env: string,
    profile: string | null
  ): Promise<void> {
    const key = `${sha}|${env}|${profile}`;
    if (this.checked.has(key)) {
      return;
    }
    const commit = `${branch} (${sha.slice(0, 7)})`;
    const marker = await this.repo.show(sha, "engine/console-protocol.json");
    if (marker === null) {
      throw new HttpError(
        409,
        `${commit} is older than the console (no engine/console-protocol.json): merge develop into it`
      );
    }
    const protocol = protocolSchema.safeParse(JSON.parse(marker));
    if (!protocol.success || protocol.data.version !== OWN_PROTOCOL) {
      throw new HttpError(
        409,
        `${commit} writes console protocol ${
          protocol.success ? protocol.data.version : "?"
        }; this console reads ${OWN_PROTOCOL}`
      );
    }
    const config = branchConfigSchema.safeParse(
      parse((await this.repo.show(sha, "e2e.config.yaml")) ?? "")
    );
    if (!config.success || config.data.environments[env] === undefined) {
      throw new HttpError(409, `${commit} has no environment ${env}`);
    }
    if (profile !== null && config.data.profiles[profile] === undefined) {
      throw new HttpError(409, `${commit} has no profile ${profile}`);
    }
    this.checked.add(key);
  }

  private async list(
    sha: string,
    env: string,
    profile: string
  ): Promise<ICatalogTest[]> {
    const folder = path.join(
      this.workDir,
      `list-${crypto.randomBytes(4).toString("hex")}`
    );
    const depsKey = await this.snapshot(
      sha,
      folder,
      env,
      new AbortController().signal
    );
    try {
      return await listTests({
        cwd: folder,
        env: runnerEnvironment(env, {
          ...this.runners.variables(env),
          E2E_ENV: env,
          E2E_PROFILE: profile,
        }),
        playwright: (args) => this.runners.node(env, [cliIn(folder), ...args]),
      });
    } finally {
      removeSnapshot(folder);
      this.deps.release(depsKey);
    }
  }

  // Where the runner of an environment keeps its sessions.
  private authDirOf(env: string): string {
    return this.runners.authDir(env) ?? this.authDir;
  }

  // The commit's files with its packages, in a folder the runner of `env` may write in; returns
  // the package set it uses.
  private async snapshot(
    sha: string,
    folder: string,
    env: string,
    signal: AbortSignal
  ): Promise<string> {
    const commit = sha.slice(0, 7);
    const manifest = await this.repo.show(sha, "package.json");
    if (manifest === null) {
      throw new Error(`${commit} has no package.json`);
    }
    const lock = await this.repo.show(sha, "pnpm-lock.yaml");
    if (lock === null) {
      throw new Error(
        `${commit} is from before nemo moved to pnpm (no pnpm-lock.yaml): rebase its branch on develop`
      );
    }
    const depsKey = this.deps.keyOf(lock);
    const modules = await this.deps.acquire(depsKey, manifest, lock, signal);
    try {
      await makeSnapshot(
        this.repo,
        sha,
        folder,
        { modules, auth: this.authDirOf(env) },
        signal
      );
      this.runners.share(env, folder);
    } catch (error) {
      removeSnapshot(folder);
      this.deps.release(depsKey);
      throw error;
    }
    return depsKey;
  }
}

function gitOf(settings: IConsoleSettings): IGitSettings {
  if (settings.git === null) {
    throw new Error("a server console needs QA_CONSOLE_GIT_URL");
  }
  return settings.git;
}

const WORKSPACES: Record<
  IConsoleMode,
  (settings: IConsoleSettings, runners: IRunners) => IWorkspace
> = {
  local: () => new WorkingTree(),
  server: (settings, runners) =>
    new GitSnapshots(settings, gitOf(settings), runners),
};

export function createWorkspace(
  settings: IConsoleSettings,
  runners: IRunners
): IWorkspace {
  return WORKSPACES[settings.mode](settings, runners);
}
