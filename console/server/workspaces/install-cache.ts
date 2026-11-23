import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// Folders installed once per key under one directory (<directory>/<key>): into a temporary folder
// first, renamed when done, so a half-done install is never used. The `kept` folders used last
// stay; a folder in use is never removed. The packages of lockfiles and the browsers of
// Playwright versions are kept this way.

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class InstallCache {
  private readonly installing = new Map<string, Promise<string>>();
  // How many prepared runs (or listings) use each folder.
  private readonly users = new Map<string, number>();

  constructor(
    private readonly directory: string,
    private readonly kept: number,
    // What the folders hold, for a message.
    private readonly what: string
  ) {}

  /** The key's folder, made by `install(folder)` if missing; it counts as used until release. */
  async acquire(
    key: string,
    install: (folder: string) => Promise<void>
  ): Promise<string> {
    this.users.set(key, (this.users.get(key) ?? 0) + 1);
    try {
      const target = path.join(this.directory, key);
      if (fs.existsSync(target)) {
        const now = new Date();
        fs.utimesSync(target, now, now);
        return target;
      }
      let installing = this.installing.get(key);
      if (installing === undefined) {
        installing = this.install(key, install).finally(() =>
          this.installing.delete(key)
        );
        this.installing.set(key, installing);
      }
      return await installing;
    } catch (error) {
      this.release(key);
      throw error;
    }
  }

  release(key: string): void {
    const count = (this.users.get(key) ?? 1) - 1;
    if (count > 0) {
      this.users.set(key, count);
    } else {
      this.users.delete(key);
    }
  }

  /** Removes half-done installs (a console stopped in the middle). */
  tidy(): void {
    if (!fs.existsSync(this.directory)) {
      return;
    }
    for (const name of fs.readdirSync(this.directory)) {
      if (name.startsWith(".tmp-")) {
        fs.rmSync(path.join(this.directory, name), {
          recursive: true,
          force: true,
        });
      }
    }
  }

  private async install(
    key: string,
    install: (folder: string) => Promise<void>
  ): Promise<string> {
    const target = path.join(this.directory, key);
    const temporary = path.join(
      this.directory,
      `.tmp-${key}-${crypto.randomBytes(4).toString("hex")}`
    );
    fs.mkdirSync(temporary, { recursive: true });
    try {
      await install(temporary);
      if (!fs.existsSync(target)) {
        fs.renameSync(temporary, target);
      }
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
    this.prune();
    return target;
  }

  // Keeps the `kept` folders used last, and every folder in use.
  private prune(): void {
    const folders = fs
      .readdirSync(this.directory)
      .filter((name) => !name.startsWith("."))
      .map((name) => ({
        name,
        usedAt: fs.statSync(path.join(this.directory, name)).mtimeMs,
      }))
      .sort((left, right) => right.usedAt - left.usedAt);
    for (const folder of folders.slice(this.kept)) {
      if (!this.users.has(folder.name)) {
        try {
          fs.rmSync(path.join(this.directory, folder.name), {
            recursive: true,
            force: true,
          });
        } catch (error) {
          console.error(
            `✗ Could not remove ${this.what} ${folder.name}: ${messageOf(
              error
            )}`
          );
        }
      }
    }
  }
}
