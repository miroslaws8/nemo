import path from "node:path";
import { E2E_ROOT } from "./paths";
import type { IRunPaths } from "./types";

// Where a run writes its files. The console gives every run a folder of its own (E2E_RUN_DIR), so
// runs keep their history and never overwrite each other. Without it the shared paths stay, which
// is what CI, its artifacts and ci/notify-slack.mts read; E2E_LIVE=1 (CI followed by the server
// console, ci/ingest.mts) adds the live events and screenshots to them, laid out like a run folder.

const REPORTS = path.join(E2E_ROOT, "reports");

export function runPaths(): IRunPaths {
  const runDir = process.env.E2E_RUN_DIR?.trim() ?? "";
  if (runDir === "") {
    const live = process.env.E2E_LIVE === "1";
    return {
      runDir: live ? REPORTS : null,
      htmlReport: path.join(REPORTS, "html"),
      jsonReport: path.join(REPORTS, "results.json"),
      junitReport: path.join(E2E_ROOT, "test-results", "junit.xml"),
      artifacts: path.join(REPORTS, "artifacts"),
      events: live ? path.join(REPORTS, "events.ndjson") : null,
      shots: live ? path.join(REPORTS, "shots") : null,
    };
  }

  const root = path.resolve(E2E_ROOT, runDir);
  return {
    runDir: root,
    htmlReport: path.join(root, "html"),
    // The JSON report embeds every step screenshot (~9 MB a run); a run folder has the events.
    jsonReport: null,
    junitReport: null,
    artifacts: path.join(root, "artifacts"),
    events: path.join(root, "events.ndjson"),
    shots: path.join(root, "shots"),
  };
}
