import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { parseAuthorArgs, verificationVerdict } from "../ai/author/verify";
import { loadE2eConfig } from "../config";
import { buildEnvironment, selectedEnvironmentName } from "../environment";
import { E2E_ROOT, TESTS_DIRECTORY } from "../paths";
import { newRunId } from "../run-info";
import { resolveRun } from "../run-selection";

// Writes a test from a description:
//   pnpm author [--env demo] "on a phone, the menu leads to the pricing page" [--verify 2] [--save]
// The AI walks the case (engine/author.spec.ts) and writes a draft in reports/author/<run id>/.
// The draft is then run on its own, without retries, --verify times in a row (default 1); each
// run's own JSON report must show it passed and every ai_check judged "pass". --save copies a
// verified draft into the environment's tests folder.

const PLAYWRIGHT_CLI = path.join(
  E2E_ROOT,
  "node_modules",
  "@playwright",
  "test",
  "cli.js"
);
// Variables of the shell that would change what a child run does.
const NOT_INHERITED = [
  "E2E_RUN_DIR",
  "E2E_LIVE",
  "E2E_AUTHOR_GOAL",
  "E2E_TEST_FILE",
];

const resultSchema = z.object({
  outcome: z.string(),
  summary: z.string(),
  draft: z
    .object({ file: z.string(), tier: z.string(), submitsForm: z.boolean() })
    .nullable(),
});

function childEnvironment(
  variables: Record<string, string>
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...process.env };
  for (const name of NOT_INHERITED) {
    delete environment[name];
  }
  return { ...environment, ...variables };
}

function runPlaywright(args: string[], env: NodeJS.ProcessEnv): number {
  const result = spawnSync(
    process.execPath,
    [PLAYWRIGHT_CLI, "test", ...args],
    { cwd: E2E_ROOT, env, stdio: "inherit" }
  );
  return result.status ?? 1;
}

/** A profile of the environment whose run includes the tier, or null. */
function profileFor(environmentName: string, tier: string): string | null {
  for (const profileName of Object.keys(loadE2eConfig().profiles)) {
    try {
      const run = resolveRun(environmentName, profileName);
      if (run.tiers.some((resolved) => resolved.name === tier)) {
        return profileName;
      }
    } catch {
      // This profile has no tier the environment allows.
    }
  }
  return null;
}

/** How many ai_check steps the draft has (its steps are flat: no templates, no repeats). */
function aiCheckSteps(draftFile: string): number {
  const document: unknown = parse(fs.readFileSync(draftFile, "utf8"));
  const tests = z
    .object({ tests: z.array(z.object({ steps: z.array(z.unknown()) })) })
    .parse(document).tests;
  return tests
    .flatMap((entry) => entry.steps)
    .filter(
      (step) => typeof step === "object" && step !== null && "ai_check" in step
    ).length;
}

function verify(
  environmentName: string,
  folder: string,
  draftFile: string,
  tier: string,
  times: number
): { verified: boolean; why: string } {
  const profile = profileFor(environmentName, tier);
  if (profile === null) {
    return {
      verified: false,
      why: `not verifiable on ${environmentName}: no profile runs the tier ${tier} there`,
    };
  }
  const checks = aiCheckSteps(draftFile);
  for (let round = 1; round <= times; round += 1) {
    console.log(
      `\nVerifying the draft (${round}/${times}) on ${environmentName}…`
    );
    const reportFile = path.join(folder, `verify-${round}.json`);
    fs.rmSync(reportFile, { force: true });
    runPlaywright(
      ["--retries=0", "--reporter=list,json"],
      childEnvironment({
        E2E_ENV: environmentName,
        E2E_PROFILE: profile,
        E2E_TEST_FILE: draftFile,
        E2E_RUN_ID: newRunId(),
        PLAYWRIGHT_JSON_OUTPUT_NAME: reportFile,
      })
    );
    const report: unknown = fs.existsSync(reportFile)
      ? JSON.parse(fs.readFileSync(reportFile, "utf8"))
      : null;
    const why = verificationVerdict(report, checks);
    if (why !== null) {
      return { verified: false, why: `run ${round}: ${why}` };
    }
  }
  return { verified: true, why: `passed ${times} time(s) in a row` };
}

function save(environmentName: string, draftFile: string): string {
  const folder = buildEnvironment(environmentName).testsFolder ?? "authored";
  const target = path.join(TESTS_DIRECTORY, folder, path.basename(draftFile));
  if (fs.existsSync(target)) {
    throw new Error(
      `${path.relative(
        E2E_ROOT,
        target
      )} exists: not overwritten (the draft stays in ${path.relative(
        E2E_ROOT,
        draftFile
      )})`
    );
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(draftFile, target);
  return path.relative(E2E_ROOT, target);
}

function main(): number {
  let args;
  try {
    args = parseAuthorArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  if (args.goal === "") {
    console.error(
      'Usage: pnpm author [--env demo] "what to check" [--verify 2] [--save]'
    );
    return 2;
  }
  const environmentName = args.environment ?? selectedEnvironmentName();
  if (buildEnvironment(environmentName).guarded) {
    console.error(
      `${environmentName} is guarded: write tests on another environment (e.g. staging); they run on ${environmentName} too`
    );
    return 2;
  }

  const id = newRunId();
  const folder = path.join(E2E_ROOT, "reports", "author", id);
  const status = runPlaywright(
    [],
    childEnvironment({
      E2E_ENV: environmentName,
      E2E_AUTHOR_GOAL: args.goal,
      E2E_RUN_ID: id,
    })
  );
  const resultFile = path.join(folder, "result.json");
  if (!fs.existsSync(resultFile)) {
    console.error(`\nThe author run wrote no result (exit ${status}).`);
    return 1;
  }
  const result = resultSchema.parse(
    JSON.parse(fs.readFileSync(resultFile, "utf8"))
  );
  console.log(`\nAuthor: ${result.outcome} — ${result.summary}`);
  console.log(`Transcript: ${path.relative(E2E_ROOT, resultFile)}`);
  if (result.draft === null) {
    return 1;
  }

  const draftFile = path.join(folder, result.draft.file);
  console.log(
    `Draft: ${path.relative(E2E_ROOT, draftFile)} (${result.draft.tier})`
  );
  const verification = verify(
    environmentName,
    folder,
    draftFile,
    result.draft.tier,
    args.verify
  );
  fs.writeFileSync(
    resultFile,
    JSON.stringify(
      { ...JSON.parse(fs.readFileSync(resultFile, "utf8")), verification },
      null,
      2
    )
  );
  console.log(
    `\n${verification.verified ? "✓ Verified" : "✗ Not verified"}: ${
      verification.why
    }`
  );
  if (!verification.verified) {
    return 1;
  }
  if (args.save) {
    try {
      console.log(`Saved: ${save(environmentName, draftFile)}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      return 1;
    }
  }
  return 0;
}

process.exitCode = main();
