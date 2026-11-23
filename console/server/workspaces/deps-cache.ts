import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DEPS_INSTALL_TIMEOUT_MS, DEPS_KEPT } from "../settings";
import { runProgram, tailOf } from "./commands";
import { InstallCache } from "./install-cache";
import { toolEnvironment } from "./runner-env";

// The packages of the commits a server console runs, shared by every commit with the same
// pnpm-lock.yaml (<data dir>/deps/<lock hash>-node<major>/node_modules). A set is installed once
// (`pnpm install --frozen-lockfile --ignore-scripts`), and the DEPS_KEPT most recently used sets
// stay; sets that runs use are never removed. pnpm's store (<data dir>/pnpm-store) is on the same
// volume, so a set's files are hard links to it; tidy() drops what no set links to any more.

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class DepsCache {
  private readonly installs: InstallCache;
  // The store's prune: no install starts while it goes.
  private pruning: Promise<void> = Promise.resolve();

  constructor(directory: string, private readonly store: string) {
    this.installs = new InstallCache(directory, DEPS_KEPT, "packages");
  }

  /** The key of a lockfile's set (with the Node major it is installed for). */
  keyOf(lock: string): string {
    const hash = crypto.createHash("sha256").update(lock).digest("hex");
    return `${hash.slice(0, 20)}-node${process.versions.node.split(".")[0]}`;
  }

  /** The node_modules of a lockfile, installed if missing; the set counts as used until release. */
  async acquire(
    key: string,
    packageJson: string,
    lock: string,
    signal: AbortSignal
  ): Promise<string> {
    await this.pruning;
    const folder = await this.installs.acquire(key, (temporary) =>
      install(temporary, this.store, packageJson, lock, signal)
    );
    return path.join(folder, "node_modules");
  }

  release(key: string): void {
    this.installs.release(key);
  }

  tidy(): void {
    this.installs.tidy();
    if (fs.existsSync(this.store)) {
      this.pruning = prune(this.store).catch((error: unknown) => {
        console.error(`✗ Could not prune the pnpm store: ${messageOf(error)}`);
      });
    }
  }
}

async function install(
  folder: string,
  store: string,
  packageJson: string,
  lock: string,
  signal: AbortSignal
): Promise<void> {
  fs.writeFileSync(path.join(folder, "package.json"), packageJson);
  fs.writeFileSync(path.join(folder, "pnpm-lock.yaml"), lock);
  const result = await runProgram(
    "pnpm",
    [
      "install",
      "--frozen-lockfile",
      "--ignore-scripts",
      `--store-dir=${store}`,
      "--loglevel=error",
    ],
    {
      cwd: folder,
      env: toolEnvironment(),
      signal,
      timeoutMs: DEPS_INSTALL_TIMEOUT_MS,
    }
  );
  if (result.code !== 0) {
    throw new Error(
      `pnpm install failed: ${tailOf(result.stderr || result.stdout)}`
    );
  }
}

// Removes the store's packages that no set links to (sets the cache removed).
async function prune(store: string): Promise<void> {
  const result = await runProgram(
    "pnpm",
    ["store", "prune", `--store-dir=${store}`, "--loglevel=error"],
    {
      cwd: path.dirname(store),
      env: toolEnvironment(),
      timeoutMs: DEPS_INSTALL_TIMEOUT_MS,
    }
  );
  if (result.code !== 0) {
    throw new Error(tailOf(result.stderr || result.stdout));
  }
}
