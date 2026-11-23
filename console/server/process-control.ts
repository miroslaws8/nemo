import { execFile, execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import type {
  ICommandLine,
  ICommandResult,
  IProcessRow,
  ISpawnedProcess,
} from "./types";

// Runs Playwright in a process group of its own, detached from the console: a run keeps going if
// the console stops, and a restarted console finds it again by pid + start time.

/** Starts a detached runner; its output goes to `logFile`, never through the console. */
export function spawnDetached(
  command: ICommandLine,
  cwd: string,
  env: NodeJS.ProcessEnv,
  logFile: string
): ISpawnedProcess {
  const log = fs.openSync(logFile, "a");
  try {
    const child = spawn(command.program, command.args, {
      cwd,
      env,
      detached: true,
      stdio: ["ignore", log, log],
    });
    if (child.pid === undefined) {
      throw new Error("the runner did not start");
    }
    child.unref();
    return { child, pid: child.pid };
  } finally {
    // The runner has its own copy of the descriptor.
    fs.closeSync(log);
  }
}

/** Runs a command to its end and returns its output whatever the exit code. */
export function runCommand(
  command: ICommandLine,
  cwd: string,
  env: NodeJS.ProcessEnv
): Promise<ICommandResult> {
  return new Promise((resolve) => {
    execFile(
      command.program,
      command.args,
      { cwd, env, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code =
          error === null ? 0 : typeof error.code === "number" ? error.code : 1;
        resolve({ code, stdout, stderr });
      }
    );
  });
}

export function processStartTime(pid: number): string | null {
  try {
    const started = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
    }).trim();
    return started === "" ? null : started;
  } catch {
    return null;
  }
}

// A process of another user (a runner, its sudo) is there too when the console may not signal it.
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

/** The same process as when it was recorded: a reused pid has another start time. */
export function isSameProcess(pid: number, startTime: string | null): boolean {
  return (
    startTime !== null && isAlive(pid) && processStartTime(pid) === startTime
  );
}

function trySignal(target: number, signal: NodeJS.Signals): void {
  try {
    process.kill(target, signal);
  } catch {
    // Already gone.
  }
}

/** Playwright stops its tests on SIGINT and still runs their cleanup. */
export function interruptGroup(groupId: number): void {
  trySignal(-groupId, "SIGINT");
}

function processTable(): IProcessRow[] {
  const output = execFileSync("ps", ["-axo", "pid=,ppid=,pgid="], {
    encoding: "utf8",
  });
  return output.split("\n").flatMap((line) => {
    const [pid, ppid, pgid] = line.trim().split(/\s+/).map(Number);
    return pid === undefined ||
      ppid === undefined ||
      pgid === undefined ||
      Number.isNaN(pid)
      ? []
      : [{ pid, ppid, pgid }];
  });
}

/**
 * Kills a runner with everything under it. Browsers start in process groups of their own, so the
 * descendants are collected first (by parent pid) and every group they are in is killed.
 * `killAsRunner` gets them first: what runs as another user (QA_CONSOLE_RUNNERS=sudo) is killed
 * as that user.
 */
export function killTree(
  rootPid: number,
  killAsRunner: (targets: number[]) => void
): void {
  const table = processTable();
  const doomed = new Set<number>([rootPid]);
  let found = true;
  while (found) {
    found = false;
    for (const row of table) {
      if (!doomed.has(row.pid) && doomed.has(row.ppid)) {
        doomed.add(row.pid);
        found = true;
      }
    }
  }
  const ownGroup = table.find((row) => row.pid === process.pid)?.pgid;
  const groups = new Set(
    table
      .filter((row) => doomed.has(row.pid) && row.pgid !== ownGroup)
      .map((row) => row.pgid)
  );
  killAsRunner([...[...groups].map((group) => -group), ...doomed]);
  for (const group of groups) {
    trySignal(-group, "SIGKILL");
  }
  for (const pid of doomed) {
    trySignal(pid, "SIGKILL");
  }
}
