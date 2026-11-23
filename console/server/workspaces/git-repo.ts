import fs from "node:fs";
import path from "node:path";
import type { IBranch } from "../../shared/types";
import { HttpError } from "../http-error";
import { BRANCH_LIST_SIZE, GIT_FETCH_INTERVAL_MS } from "../settings";
import type { ICommandResult, IGitSettings } from "../types";
import { runProgram, tailOf } from "./commands";
import { toolEnvironment } from "./runner-env";

// A bare clone of myqa (<data dir>/git/myqa.git) that the server console runs tests from.
// Its branches mirror the repository's, fetched at most every GIT_FETCH_INTERVAL_MS. Every run
// pins its commit (refs/qa-console/runs/<run id>), so a force-push or a deleted branch never takes
// the YAML of a run that is still kept. The token travels in an HTTP header set through git's
// environment: never on a command line, in a URL or in the clone's config.

const SHA = /^[0-9a-f]{40}$/;
// Branch names git accepts, and none that could read as an option.
const BRANCH_NAME = /^[A-Za-z0-9_][A-Za-z0-9._/-]*$/;
const PIN_PREFIX = "refs/qa-console/runs/";
const FIELD = "%00";

export class GitRepo {
  private fetchedAt = 0;
  private fetching: Promise<void> | null = null;

  constructor(
    private readonly directory: string,
    private readonly settings: IGitSettings
  ) {
    fs.mkdirSync(path.dirname(directory), { recursive: true });
  }

  /** The commit a branch points to now (fetched when the last fetch is old); 404 if none. */
  async branchHead(branch: string): Promise<string> {
    if (!BRANCH_NAME.test(branch) || branch.includes("..")) {
      throw new HttpError(400, `"${branch}" is not a branch name`);
    }
    await this.refresh();
    const result = await this.git([
      "rev-parse",
      "--verify",
      "--quiet",
      `refs/heads/${branch}^{commit}`,
    ]);
    const sha = result.stdout.trim();
    if (result.code !== 0 || !SHA.test(sha)) {
      throw new HttpError(404, `myqa has no branch "${branch}"`);
    }
    return sha;
  }

  /** The branches, newest commit first. */
  async branches(): Promise<IBranch[]> {
    await this.refresh();
    const result = await this.git([
      "for-each-ref",
      "--sort=-committerdate",
      `--count=${BRANCH_LIST_SIZE}`,
      `--format=%(refname:lstrip=2)${FIELD}%(objectname)${FIELD}%(committerdate:iso-strict)${FIELD}%(subject)`,
      "refs/heads",
    ]);
    return result.stdout
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => {
        const [name = "", sha = "", committedAt = "", subject = ""] =
          line.split("\0");
        return { name, sha, committedAt, subject };
      });
  }

  /** A file of a commit; null when the commit has no such file. */
  async show(sha: string, file: string): Promise<string | null> {
    if (!SHA.test(sha) || file.startsWith("/") || file.includes("..")) {
      return null;
    }
    const result = await this.git(["cat-file", "blob", `${sha}:${file}`]);
    return result.code === 0 ? result.stdout : null;
  }

  /** The names in a folder of a commit ([] for none). */
  async list(sha: string, folder: string): Promise<string[]> {
    if (!SHA.test(sha) || folder.startsWith("/") || folder.includes("..")) {
      return [];
    }
    const result = await this.git([
      "ls-tree",
      "--name-only",
      `${sha}:${folder}`,
    ]);
    return result.code === 0
      ? result.stdout.split("\n").filter((name) => name !== "")
      : [];
  }

  /** Writes a commit's files as a tar archive. */
  async archive(
    sha: string,
    tarFile: string,
    signal: AbortSignal
  ): Promise<void> {
    const result = await this.git(
      ["archive", "--format=tar", `--output=${tarFile}`, sha],
      signal
    );
    if (result.code !== 0) {
      throw new Error(
        `git archive ${sha.slice(0, 7)}: ${tailOf(result.stderr)}`
      );
    }
  }

  async pin(runId: string, sha: string): Promise<void> {
    const result = await this.git(["update-ref", `${PIN_PREFIX}${runId}`, sha]);
    if (result.code !== 0) {
      throw new HttpError(
        500,
        `could not keep commit ${sha}: ${tailOf(result.stderr)}`
      );
    }
  }

  async unpin(runIds: string[]): Promise<void> {
    for (const runId of runIds) {
      await this.git(["update-ref", "-d", `${PIN_PREFIX}${runId}`]);
    }
  }

  // Fetches unless a fetch is recent; one fetch at a time.
  private async refresh(): Promise<void> {
    if (Date.now() - this.fetchedAt < GIT_FETCH_INTERVAL_MS) {
      return;
    }
    this.fetching ??= this.fetch().finally(() => {
      this.fetching = null;
    });
    await this.fetching;
  }

  private async fetch(): Promise<void> {
    if (!fs.existsSync(path.join(this.directory, "HEAD"))) {
      const created = await runProgram(
        "git",
        ["init", "--bare", "--quiet", this.directory],
        { cwd: path.dirname(this.directory), env: toolEnvironment() }
      );
      if (created.code !== 0) {
        throw new HttpError(
          500,
          `could not create the clone: ${tailOf(created.stderr)}`
        );
      }
    }
    const result = await this.git([
      "fetch",
      "--prune",
      "--no-tags",
      "--quiet",
      this.settings.url,
      "+refs/heads/*:refs/heads/*",
    ]);
    if (result.code !== 0) {
      throw new HttpError(
        502,
        `the console cannot fetch myqa: ${tailOf(result.stderr)}`
      );
    }
    this.fetchedAt = Date.now();
  }

  private git(args: string[], signal?: AbortSignal): Promise<ICommandResult> {
    return runProgram("git", [`--git-dir=${this.directory}`, ...args], {
      cwd: path.dirname(this.directory),
      env: { ...toolEnvironment(), ...this.credentials() },
      signal,
    });
  }

  // A repository access token as git's HTTP basic auth (user x-token-auth), set for this call only.
  private credentials(): Record<string, string> {
    if (this.settings.token === null) {
      return {};
    }
    const basic = Buffer.from(`x-token-auth:${this.settings.token}`).toString(
      "base64"
    );
    return {
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "http.extraHeader",
      GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
    };
  }
}
