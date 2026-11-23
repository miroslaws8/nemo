import { ApiClient } from "../api-client";
import { gatewayFor, RESOURCE_GATEWAYS } from "../cleanup/gateways";
import { deletionRefusal } from "../cleanup/guard";
import { fetchTestUserId } from "../cleanup/test-user";
import { loadE2eConfig } from "../config";
import { buildEnvironment, selectedEnvironmentName } from "../environment";
import { RUN_ID_PATTERN } from "../run-info";
import { durationSchema, parseDuration } from "../schema";
import type {
  IDuration,
  IE2eConfig,
  IOwnedRecord,
  ISweepCandidate,
  ISweepOptions,
  ISweepReport,
  ISweepSelection,
} from "../types";
import { optionValue } from "./cli-options";

// Deletes test data left behind by failed or interrupted runs:
//   pnpm sweep [--env staging] [--older-than 1d | --run <run id>] [--apply] [--json]
// Without --apply it only lists what it would delete. --older-than overrides sweeper.older_than;
// --run takes one run's data whatever its age (titles "<data_prefix><run id> …"). --json prints one
// JSON object (for the console). It uses the session of the last login
// (E2E_ENV=<env> pnpm exec playwright test --project=<env>:login).

function parseOlderThan(value: string | null): IDuration | null {
  if (value === null) {
    return null;
  }
  const parsed = durationSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `--older-than "${value}": use a duration like 30m, 12h or 1d`
    );
  }
  return parsed.data;
}

function parseRunId(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  if (!RUN_ID_PATTERN.test(value)) {
    throw new Error(
      `--run "${value}": not a run id (e.g. c20261113-171530-a3f9, or a CI build number)`
    );
  }
  return value;
}

function parseOptions(argv: string[]): ISweepOptions {
  return {
    environmentName: optionValue(argv, "--env") ?? selectedEnvironmentName(),
    olderThan: parseOlderThan(optionValue(argv, "--older-than")),
    runId: parseRunId(optionValue(argv, "--run")),
    apply: argv.includes("--apply"),
    json: argv.includes("--json"),
  };
}

function selectionFor(
  options: ISweepOptions,
  config: IE2eConfig
): ISweepSelection {
  if (options.runId !== null) {
    const titlePrefix = `${config.safety.data_prefix}${options.runId} `;
    return {
      label: `belong to run ${options.runId}`,
      matches: (record) => record.title.startsWith(titlePrefix),
    };
  }
  const olderThan = options.olderThan ?? config.sweeper.older_than;
  const cutoff = new Date(Date.now() - parseDuration(olderThan, 0));
  return {
    label: `are older than ${String(olderThan)}`,
    matches: (record) => record.createdAt !== null && record.createdAt < cutoff,
  };
}

function toCandidate(record: IOwnedRecord): ISweepCandidate {
  return {
    kind: record.kind,
    id: record.id,
    title: record.title,
    createdAt: record.createdAt?.toISOString() ?? null,
    trashed: record.trashed,
  };
}

function describeCandidate(candidate: ISweepCandidate): string {
  const created = candidate.createdAt?.slice(0, 16) ?? "?";
  const state = candidate.trashed ? " (in trash)" : "";
  return `${candidate.kind} ${candidate.id} "${candidate.title}" created ${created}${state}`;
}

function describeRecord(record: IOwnedRecord): string {
  return describeCandidate(toCandidate(record));
}

async function findCandidates(
  api: ApiClient,
  testUserId: number,
  selection: ISweepSelection
): Promise<IOwnedRecord[]> {
  const candidates: IOwnedRecord[] = [];
  for (const gateway of RESOURCE_GATEWAYS) {
    const owned = await gateway.listOwned(api, testUserId);
    candidates.push(
      ...owned.filter(
        (record) =>
          deletionRefusal(record, testUserId) === null &&
          selection.matches(record)
      )
    );
  }
  return candidates;
}

// Each record is read again right before deletion (trash items come from the owner's own trash
// list), so nothing changes hands between listing and deleting.
async function deleteCandidate(
  api: ApiClient,
  record: IOwnedRecord,
  testUserId: number
): Promise<string> {
  const gateway = gatewayFor(record.kind);
  const current = record.trashed ? record : await gateway.fetch(api, record.id);
  if (current === null) {
    return `already gone: ${describeRecord(record)}`;
  }
  const refusal = deletionRefusal(current, testUserId);
  if (refusal !== null) {
    return `skipped ${describeRecord(record)} — ${refusal}`;
  }
  await gateway.remove(api, current);
  return `deleted ${describeRecord(record)}`;
}

function printText(report: ISweepReport): void {
  console.log(
    report.userId === null
      ? `${report.environment}: nothing to look for — no resource gateway is registered (engine/cleanup/gateways.ts) or the environment has no account`
      : `${report.environment}: ${report.candidates.length} record(s) of user ${report.userId} start with "${report.dataPrefix}" and ${report.selection}`
  );
  if (report.userId === null) {
    return;
  }
  for (const candidate of report.candidates) {
    console.log(`  ${describeCandidate(candidate)}`);
  }
  if (report.refusal !== null) {
    console.error(`✗ ${report.refusal}`);
    return;
  }
  if (!report.applied) {
    console.log("Dry run — re-run with --apply to delete them.");
    return;
  }
  for (const outcome of report.outcomes) {
    console.log(`  ${outcome}`);
  }
}

async function sweep(options: ISweepOptions): Promise<ISweepReport> {
  const environment = buildEnvironment(options.environmentName);
  const config = loadE2eConfig();
  const selection = selectionFor(options, config);

  // Nothing to look for: no gateway is registered, or the environment has no account (and so no
  // data of its own). No API call is made.
  if (RESOURCE_GATEWAYS.length === 0 || !environment.signsIn) {
    return {
      environment: environment.name,
      userId: null,
      dataPrefix: config.safety.data_prefix,
      selection: selection.label,
      candidates: [],
      applied: options.apply,
      outcomes: [],
      refusal: null,
    };
  }

  const api = await ApiClient.create(environment);
  try {
    const testUser = { id: await fetchTestUserId(api) };
    const candidates = await findCandidates(api, testUser.id, selection);
    const report: ISweepReport = {
      environment: environment.name,
      userId: testUser.id,
      dataPrefix: config.safety.data_prefix,
      selection: selection.label,
      candidates: candidates.map(toCandidate),
      applied: false,
      outcomes: [],
      refusal: null,
    };

    if (candidates.length > config.sweeper.max_deletes) {
      report.refusal = `${candidates.length} is more than sweeper.max_deletes (${config.sweeper.max_deletes}) — nothing deleted; check the list above`;
      return report;
    }
    if (options.apply) {
      for (const record of candidates) {
        report.outcomes.push(await deleteCandidate(api, record, testUser.id));
      }
      report.applied = true;
    }
    return report;
  } finally {
    await api.dispose();
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  try {
    const report = await sweep(parseOptions(argv));
    if (json) {
      console.log(JSON.stringify(report));
    } else {
      printText(report);
    }
    if (report.refusal !== null) {
      process.exitCode = 1;
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const needsLogin =
      message.includes("→ 401") || message.includes("is missing");
    if (json) {
      console.log(JSON.stringify({ error: message, needsLogin }));
    } else {
      console.error(`✗ ${message}`);
      if (needsLogin) {
        console.error(
          "  Log in first: E2E_ENV=<env> pnpm exec playwright test --project=<env>:login"
        );
      }
    }
    process.exitCode = 1;
  }
}

void main();
