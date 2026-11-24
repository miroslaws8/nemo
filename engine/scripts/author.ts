import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { parseAuthorArgs } from "../ai/author/verify";
import { buildEnvironment, selectedEnvironmentName } from "../environment";
import { E2E_ROOT, TESTS_DIRECTORY } from "../paths";
import { newRunId } from "../run-info";

// Writes a test from a description:
//   pnpm author [--env demo] "on a phone, the menu leads to the pricing page" [--verify 2] [--save]
// The AI walks the case (engine/author.spec.ts), writes a draft in reports/author/<run id>/ and,
// in the same run, runs it on its own --verify times in a row (default 1, no retries, every
// ai_check judged "pass"). --save copies a verified draft into the environment's tests folder.

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
  verification: z.object({ verified: z.boolean(), why: z.string() }).nullable(),
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
      E2E_AUTHOR_VERIFY: String(args.verify),
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
  const verification = result.verification ?? {
    verified: false,
    why: "the draft was not verified",
  };
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
