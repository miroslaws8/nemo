import fs from "node:fs";
import path from "node:path";
import type { GitRepo } from "./git-repo";
import { runProgram, tailOf } from "./commands";
import { toolEnvironment } from "./runner-env";

// A commit's files in a folder of their own (<data dir>/work/<name>): what a run, or a listing of
// its tests, works in. node_modules links to the shared packages of its lockfile, .auth to the
// sessions every run of the server shares. The folder goes when the run is over.

export interface ISnapshotLinks {
  modules: string;
  auth: string;
}

export async function makeSnapshot(
  repo: GitRepo,
  sha: string,
  folder: string,
  links: ISnapshotLinks,
  signal: AbortSignal
): Promise<void> {
  const archive = `${folder}.tar`;
  fs.mkdirSync(folder, { recursive: true });
  try {
    await repo.archive(sha, archive, signal);
    const unpacked = await runProgram("tar", ["-xf", archive, "-C", folder], {
      cwd: path.dirname(folder),
      env: toolEnvironment(),
      signal,
    });
    if (unpacked.code !== 0) {
      throw new Error(
        `could not unpack ${sha.slice(0, 7)}: ${tailOf(unpacked.stderr)}`
      );
    }
  } finally {
    fs.rmSync(archive, { force: true });
  }
  fs.mkdirSync(links.auth, { recursive: true });
  fs.symlinkSync(links.modules, path.join(folder, "node_modules"), "dir");
  fs.symlinkSync(links.auth, path.join(folder, ".auth"), "dir");
}

export function removeSnapshot(folder: string): void {
  fs.rmSync(folder, { recursive: true, force: true });
}
