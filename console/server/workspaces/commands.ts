import { execFile } from "node:child_process";
import type { ICommandResult } from "../types";

// Runs a program (git, tar, pnpm) to its end; the signal (a stopped run) ends it early.

const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

export interface IProgramOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** The program's output whatever its exit code; throws only when it could not run or was stopped. */
export function runProgram(
  program: string,
  args: string[],
  options: IProgramOptions
): Promise<ICommandResult> {
  return new Promise((resolve, reject) => {
    execFile(
      program,
      args,
      {
        cwd: options.cwd,
        env: options.env,
        signal: options.signal,
        timeout: options.timeoutMs ?? 0,
        maxBuffer: MAX_OUTPUT_BYTES,
      },
      (error, stdout, stderr) => {
        if (error !== null && options.signal?.aborted === true) {
          reject(new Error("stopped"));
          return;
        }
        if (error !== null && error.killed === true) {
          reject(new Error(`${program} took too long and was stopped`));
          return;
        }
        if (error !== null && typeof error.code !== "number") {
          reject(new Error(`${program} did not run: ${error.message}`));
          return;
        }
        resolve({
          code: error === null ? 0 : Number(error.code),
          stdout,
          stderr,
        });
      }
    );
  });
}

/** The last lines of a program's error output, for a message. */
export function tailOf(text: string): string {
  return text.trim().split("\n").slice(-6).join("\n").slice(-800);
}
