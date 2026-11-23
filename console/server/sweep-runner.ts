import { E2E_ROOT } from "../../engine/paths";
import { sweepErrorSchema, sweepReportSchema } from "../shared/api";
import type { ISweepResult } from "../shared/types";
import { HttpError } from "./http-error";
import { runCommand } from "./process-control";
import { PLAYWRIGHT_CLI } from "./settings";
import type { ICommandLine } from "./types";

// Cleans up one run's data through `pnpm sweep --run <id> --json` (the same guard as the
// sweeper: data prefix, owner, protected titles, max_deletes). A revoked session logs in again once.

// `variables`: what the workspace adds (a server's shared sessions: E2E_AUTH_DIR).
function cleanEnvironment(
  env: string,
  variables: Record<string, string>
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    ...variables,
    E2E_ENV: env,
  };
  delete environment.E2E_RUN_DIR;
  delete environment.E2E_RUN_ID;
  return environment;
}

// The console's own code (not a branch's): it runs as the console.
function ownNode(args: string[]): ICommandLine {
  return { program: process.execPath, args };
}

async function sweepOnce(
  env: string,
  runId: string,
  apply: boolean,
  variables: Record<string, string>
): Promise<ISweepResult | { error: string; needsLogin: boolean }> {
  const result = await runCommand(
    ownNode([
      "--import",
      "tsx",
      "engine/scripts/sweep.ts",
      "--env",
      env,
      "--run",
      runId,
      "--json",
      ...(apply ? ["--apply"] : []),
    ]),
    E2E_ROOT,
    cleanEnvironment(env, variables)
  );
  const lastLine = result.stdout.trim().split("\n").at(-1) ?? "";
  let raw: unknown;
  try {
    raw = JSON.parse(lastLine);
  } catch {
    throw new HttpError(
      500,
      `sweep failed: ${result.stderr.trim().slice(0, 500) || "no output"}`
    );
  }
  const report = sweepReportSchema.safeParse(raw);
  if (report.success) {
    return report.data;
  }
  const failure = sweepErrorSchema.safeParse(raw);
  if (failure.success) {
    return failure.data;
  }
  throw new HttpError(500, "sweep printed something unexpected");
}

async function logIn(
  env: string,
  variables: Record<string, string>
): Promise<void> {
  const result = await runCommand(
    ownNode([
      PLAYWRIGHT_CLI,
      "test",
      `--project=${env}:login`,
      "--reporter=line",
    ]),
    E2E_ROOT,
    cleanEnvironment(env, variables)
  );
  if (result.code !== 0) {
    throw new HttpError(502, `could not log in to ${env} for the cleanup`);
  }
}

export async function sweepRun(
  env: string,
  runId: string,
  apply: boolean,
  variables: Record<string, string>
): Promise<ISweepResult> {
  let outcome = await sweepOnce(env, runId, apply, variables);
  if ("error" in outcome && outcome.needsLogin) {
    await logIn(env, variables);
    outcome = await sweepOnce(env, runId, apply, variables);
  }
  if ("error" in outcome) {
    throw new HttpError(502, outcome.error);
  }
  return outcome;
}
