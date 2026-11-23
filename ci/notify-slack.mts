import fs from "node:fs";
import path from "node:path";
import type {
  IFailedTest,
  IJsonReport,
  IReadyReport,
  IReportSuite,
} from "../engine/types/index.ts";

// Posts the run's outcome to Slack from the step's after-script. Node runs this file directly
// (no npm packages), so it still reports when `pnpm install` or the login failed.
//   Failures always; a success only when E2E_NOTIFY_SUCCESS=true (prod after a deploy).
//   Without SLACK_WEBHOOK_URL it prints the message instead (local runs).

const ROOT = path.resolve(import.meta.dirname, "..");
const RESULTS_PATH = path.join(ROOT, "reports", "results.json");
const READY_PATH = path.join(ROOT, "reports", "ready.json");
const MAX_LISTED = 5;
const KEPT_ANNOTATION = "kept for debugging";

function readJson(filePath: string): unknown {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function isJsonReport(value: unknown): value is IJsonReport {
  return (
    typeof value === "object" &&
    value !== null &&
    "stats" in value &&
    "suites" in value &&
    Array.isArray(value.suites)
  );
}

function isReadyReport(value: unknown): value is IReadyReport {
  return typeof value === "object" && value !== null && "outcome" in value;
}

// Session tokens must never reach Slack, even inside an error message.
function redact(text: string): string {
  return text.replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/g, "Bearer ***");
}

function firstLine(text: string): string {
  return redact(
    text.split("\n").find((line) => line.trim() !== "") ?? ""
  ).slice(0, 200);
}

function collectFailures(suites: IReportSuite[]): IFailedTest[] {
  return suites.flatMap((suite) => [
    ...(suite.specs ?? []).flatMap((spec) =>
      spec.tests
        .filter((test) => test.status === "unexpected")
        .map((test) => ({
          title: spec.title,
          file:
            test.annotations?.find((annotation) => annotation.type === "file")
              ?.description ?? null,
          error: firstLine(
            test.results.at(-1)?.error?.message ?? "no error message"
          ),
        }))
    ),
    ...collectFailures(suite.suites ?? []),
  ]);
}

function collectKept(suites: IReportSuite[]): string[] {
  return suites.flatMap((suite) => [
    ...(suite.specs ?? []).flatMap((spec) =>
      spec.tests.flatMap((test) =>
        (test.results.at(-1)?.annotations ?? [])
          .filter((annotation) => annotation.type === KEPT_ANNOTATION)
          .map((annotation) => annotation.description ?? "")
      )
    ),
    ...collectKept(suite.suites ?? []),
  ]);
}

function deployLine(): string | null {
  const builds = [
    ["frontend", process.env.E2E_EXPECT_FRONTEND_BUILD],
    ["api", process.env.E2E_EXPECT_API_BUILD],
  ].filter(([, build]) => build !== undefined && build !== "");
  return builds.length === 0
    ? null
    : `Deploy: ${builds
        .map(([name, build]) => `${name} ${build}`)
        .join(" · ")}`;
}

// The CI this step runs on: Bitbucket Pipelines or GitHub Actions. `link`: the run's page, null
// when this is not that CI; `failed`: whether the step's tests failed.
interface ICiProvider {
  link: () => string | null;
  failed: () => boolean;
}

const CI_PROVIDERS: ICiProvider[] = [
  {
    link: () => {
      const origin = process.env.BITBUCKET_GIT_HTTP_ORIGIN;
      const build = process.env.BITBUCKET_BUILD_NUMBER;
      return origin && build
        ? `<${origin}/pipelines/results/${build}|Pipeline #${build}>`
        : null;
    },
    failed: () => (process.env.BITBUCKET_EXIT_CODE ?? "0") !== "0",
  },
  {
    link: () => {
      const server = process.env.GITHUB_SERVER_URL;
      const repository = process.env.GITHUB_REPOSITORY;
      const runId = process.env.GITHUB_RUN_ID;
      const runNumber = process.env.GITHUB_RUN_NUMBER;
      return server && repository && runId
        ? `<${server}/${repository}/actions/runs/${runId}|Run #${
            runNumber ?? runId
          }>`
        : null;
    },
    // The workflow passes its test step's outcome (steps.<id>.outcome).
    failed: () => process.env.E2E_STEP_OUTCOME === "failure",
  },
];

function currentProvider(): ICiProvider | null {
  return CI_PROVIDERS.find((provider) => provider.link() !== null) ?? null;
}

function pipelineLink(): string | null {
  return currentProvider()?.link() ?? null;
}

function listed(lines: string[]): string[] {
  const extra = lines.length - MAX_LISTED;
  return [
    ...lines.slice(0, MAX_LISTED),
    ...(extra > 0 ? [`… and ${extra} more`] : []),
  ];
}

/** The Slack text for this run, or null when nothing should be posted. */
function buildMessage(): string | null {
  const environment = process.env.E2E_ENV ?? "?";
  const profile = process.env.E2E_PROFILE ?? "?";
  const stepFailed = currentProvider()?.failed() ?? false;
  const heading = `E2E ${environment} · ${profile}`;
  const ready = readJson(READY_PATH);
  const report = readJson(RESULTS_PATH);

  if (isReadyReport(ready) && ready.outcome === "superseded") {
    return null;
  }

  let body: string[];
  let failed: boolean;
  if (isReadyReport(ready) && ready.outcome === "timeout") {
    failed = true;
    body = [
      `:x: *${heading}* — the deploy is not serving after ${ready.waitedSeconds}s`,
      `Expected ${JSON.stringify(ready.expected)}, serving ${JSON.stringify(
        ready.served
      )}`,
    ];
  } else if (!isJsonReport(report)) {
    if (!stepFailed) {
      return null;
    }
    failed = true;
    body = [
      `:x: *${heading}* — crashed before the tests reported (install or login?)`,
    ];
  } else {
    const { stats } = report;
    failed = stepFailed || stats.unexpected > 0;
    const counts = `${stats.unexpected} failed, ${stats.expected} passed, ${stats.flaky} flaky, ${stats.skipped} skipped`;
    body = [
      `${failed ? ":x:" : ":white_check_mark:"} *${heading}* — ${counts}`,
      ...listed(
        collectFailures(report.suites).map(
          (failure) =>
            `• ${failure.title} — ${failure.error}${
              failure.file ? ` (${failure.file})` : ""
            }`
        )
      ),
      ...listed(
        collectKept(report.suites).map((kept) => `Kept for debugging: ${kept}`)
      ),
    ];
  }

  if (!failed && process.env.E2E_NOTIFY_SUCCESS !== "true") {
    return null;
  }
  return [...body, deployLine(), pipelineLink()]
    .filter((line): line is string => line !== null)
    .join("\n");
}

async function main(): Promise<void> {
  const message = buildMessage();
  if (message === null) {
    console.log("notify-slack: nothing to report");
    return;
  }
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) {
    console.log(
      `notify-slack: SLACK_WEBHOOK_URL is not set; the message would be:\n${message}`
    );
    return;
  }
  const response = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: message }),
  });
  console.log(`notify-slack: Slack answered ${response.status}`);
}

main().catch((error: unknown) => {
  console.error(
    `notify-slack: ${error instanceof Error ? error.message : String(error)}`
  );
});
