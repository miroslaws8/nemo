import fs from "node:fs";
import path from "node:path";
import { getEnvironment } from "../engine/environment";
import { E2E_ROOT } from "../engine/paths";
import { durationSchema, parseDuration } from "../engine/schema";
import type {
  IBuildProbe,
  IDeployTarget,
  IDeployTargetName,
  IReadyOutcome,
  IReadyReport,
} from "../engine/types";

// Waits until the deploy that triggered this run is actually serving: a GitOps deploy
// often only commits the new tag, and the pods roll out after it has finished.
//   E2E_EXPECT_FRONTEND_BUILD / E2E_EXPECT_API_BUILD — the image tag to wait for (empty = just
//   wait for HTTP 200); E2E_READY_TIMEOUT — default 15m.
// Writes reports/ready.json; exits 0 when ready or superseded, 1 on timeout.

const POLL_INTERVAL_MS = 10_000;
// Pods are replaced one by one: three matching polls in a row mean every pod serves the build.
const REQUIRED_MATCHES = 3;
const DEFAULT_TIMEOUT = "15m";
const REPORT_PATH = path.join(E2E_ROOT, "reports", "ready.json");
const EXPECTED_BUILD_VARIABLES: Record<IDeployTargetName, string> = {
  frontend: "E2E_EXPECT_FRONTEND_BUILD",
  api: "E2E_EXPECT_API_BUILD",
};

function expectedBuild(name: IDeployTargetName): string | null {
  const value = process.env[EXPECTED_BUILD_VARIABLES[name]]?.trim() ?? "";
  return value === "" ? null : value;
}

function readTimeoutMs(): number {
  const parsed = durationSchema.safeParse(
    process.env.E2E_READY_TIMEOUT ?? DEFAULT_TIMEOUT
  );
  if (!parsed.success) {
    throw new Error("E2E_READY_TIMEOUT: use a duration like 30s, 15m or 1h");
  }
  return parseDuration(parsed.data, 0);
}

function buildTargets(): IDeployTarget[] {
  const environment = getEnvironment();
  const targets: IDeployTarget[] = [
    {
      name: "frontend",
      url: `${environment.baseUrl}/version.json`,
      expectedBuild: expectedBuild("frontend"),
    },
  ];
  const apiBuild = expectedBuild("api");
  if (environment.apiUrl !== null) {
    targets.push({
      name: "api",
      url: `${environment.apiUrl}/api/health`,
      expectedBuild: apiBuild,
    });
  } else if (apiBuild !== null) {
    throw new Error(
      `E2E_EXPECT_API_BUILD is set, but ${environment.name} has no api_url in e2e.config.yaml`
    );
  }
  return targets;
}

function readBuild(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "build" in parsed &&
      typeof parsed.build === "string"
    ) {
      return parsed.build;
    }
  } catch {
    // An HTML page (the SPA fallback) means the build id is not deployed there yet.
  }
  return null;
}

async function probe(target: IDeployTarget): Promise<IBuildProbe> {
  try {
    const response = await fetch(`${target.url}?ts=${Date.now()}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(POLL_INTERVAL_MS),
    });
    return {
      reachable: response.ok,
      build: response.ok ? readBuild(await response.text()) : null,
    };
  } catch {
    return { reachable: false, build: null };
  }
}

// Image tags end in the pipeline's build number (develop_ab12cd3_812); a larger one is newer.
function buildNumber(build: string): number | null {
  const match = build.match(/_(\d+)$/);
  return match ? Number(match[1]) : null;
}

function isNewer(servedBuild: string | null, expected: string): boolean {
  if (servedBuild === null) {
    return false;
  }
  const served = buildNumber(servedBuild);
  const wanted = buildNumber(expected);
  return served !== null && wanted !== null && served > wanted;
}

function writeReport(
  outcome: IReadyOutcome,
  targets: IDeployTarget[],
  served: Map<IDeployTargetName, string | null>,
  startedAt: number
): void {
  const report: IReadyReport = {
    outcome,
    environment: getEnvironment().name,
    expected: Object.fromEntries(
      targets.flatMap((target) =>
        target.expectedBuild === null
          ? []
          : [[target.name, target.expectedBuild]]
      )
    ),
    served: Object.fromEntries(served),
    waitedSeconds: Math.round((Date.now() - startedAt) / 1000),
  };
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`ready.json: ${outcome} after ${report.waitedSeconds}s`);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function main(): Promise<void> {
  const targets = buildTargets();
  const startedAt = Date.now();
  const deadline = startedAt + readTimeoutMs();
  const matches = new Map<IDeployTargetName, number>();
  const served = new Map<IDeployTargetName, string | null>();

  for (;;) {
    for (const target of targets) {
      const result = await probe(target);
      served.set(target.name, result.build);

      if (target.expectedBuild === null) {
        matches.set(target.name, result.reachable ? REQUIRED_MATCHES : 0);
        continue;
      }
      if (isNewer(result.build, target.expectedBuild)) {
        console.log(
          `${target.name}: ${String(result.build)} is newer than ${
            target.expectedBuild
          }`
        );
        writeReport("superseded", targets, served, startedAt);
        return;
      }
      const matched = result.build === target.expectedBuild;
      matches.set(
        target.name,
        matched ? (matches.get(target.name) ?? 0) + 1 : 0
      );
      console.log(
        `${target.name}: serving ${String(result.build)}, waiting for ${
          target.expectedBuild
        }`
      );
    }

    if (
      targets.every(
        (target) => (matches.get(target.name) ?? 0) >= REQUIRED_MATCHES
      )
    ) {
      writeReport("ready", targets, served, startedAt);
      return;
    }
    if (Date.now() >= deadline) {
      writeReport("timeout", targets, served, startedAt);
      process.exitCode = 1;
      return;
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
