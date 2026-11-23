import fs from "node:fs";
import path from "node:path";
import { RUN_ID_PATTERN } from "../../engine/run-info";
import { runRecordSchema } from "../shared/api";
import { emptyRunState, reduceRun } from "../shared/reducer";
import type { IRunRecord, IRunState } from "../shared/types";
import { HttpError } from "./http-error";
import { readAllEvents } from "./ndjson-tail";
import { consoleSettings } from "./config";

// Runs live on disk, one folder each: <data dir>/runs/<run id>/ (reports/runs/ on a developer's
// machine). run.json is the record, the rest is what the run wrote (events.ndjson, console.log,
// html/, artifacts/, shots/, test-list.txt).

// A CI run the console follows: b<build number>, and -2, -3… for a rerun of its step.
const CI_RUN_ID = /^b\d+(-\d+)?$/;

export function isRunId(value: string): boolean {
  return RUN_ID_PATTERN.test(value) || CI_RUN_ID.test(value);
}

/** The run id of a route's `id` (404 for anything that is not one). */
export function runIdFrom(params: Record<string, string>): string {
  const id = params.id ?? "";
  if (!isRunId(id)) {
    throw new HttpError(404, `no run ${id}`);
  }
  return id;
}

export function runDirectory(id: string): string {
  return path.join(consoleSettings().runsDir, id);
}

export function runFile(id: string, name: string): string {
  return path.join(runDirectory(id), name);
}

/** Written to a temporary file and renamed, so a reader never sees half a record. */
export function writeRun(record: IRunRecord): void {
  fs.mkdirSync(runDirectory(record.id), { recursive: true });
  const target = runFile(record.id, "run.json");
  const temporary = `${target}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`);
  fs.renameSync(temporary, target);
}

export function readRun(id: string): IRunRecord | null {
  if (!isRunId(id)) {
    return null;
  }
  try {
    const parsed = runRecordSchema.safeParse(
      JSON.parse(fs.readFileSync(runFile(id, "run.json"), "utf8"))
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Every run with a record, newest first (a folder without one is not a console run). */
export function listRuns(): IRunRecord[] {
  const runsDir = consoleSettings().runsDir;
  if (!fs.existsSync(runsDir)) {
    return [];
  }
  return fs
    .readdirSync(runsDir)
    .flatMap((name) => {
      const record = readRun(name);
      return record === null ? [] : [record];
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

/**
 * Deletes the folders of the runs past the newest `keep`, except runs still going or waiting
 * (`isBusy`). Returns the ids it deleted.
 */
/** Keeps the newest `keep` of the console's own runs and, apart, of the CI runs it followed. */
export function pruneRuns(
  keep: number,
  isBusy: (id: string) => boolean
): string[] {
  const records = listRuns();
  const old = [
    ...records.filter((record) => record.ci === null).slice(keep),
    ...records.filter((record) => record.ci !== null).slice(keep),
  ];
  const removed: string[] = [];
  for (const record of old) {
    if (isBusy(record.id)) {
      continue;
    }
    try {
      fs.rmSync(runDirectory(record.id), { recursive: true, force: true });
      removed.push(record.id);
    } catch {
      // A folder that cannot go now is tried again after the next run.
    }
  }
  return removed;
}

/** A finished run's state, replayed from its events. */
export function rebuildState(id: string): IRunState {
  const state = emptyRunState();
  for (const event of readAllEvents(runFile(id, "events.ndjson"))) {
    reduceRun(state, event);
  }
  return state;
}
