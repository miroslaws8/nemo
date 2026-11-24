import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { loadE2eConfig } from "../config";
import { buildEnvironment, selectedEnvironmentName } from "../environment";
import { E2E_ROOT, TESTS_DIRECTORY } from "../paths";
import { newRunId } from "../run-info";
import { resolveRun } from "../run-selection";
import { optionValue } from "./cli-options";

// Writes a test from a description:
//   pnpm author [--env demo] "on a phone, the menu leads to the pricing page" [--verify 2] [--save]
// The AI walks the case (engine/author.spec.ts) and writes a draft in reports/author/<run id>/;
// the draft is then run on its own, without retries, --verify times in a row (default 1), and
// counts as verified only if every run passed and every ai_check in it was judged "pass".
// --save copies a verified draft into the environment's tests folder.

const PLAYWRIGHT_CLI = path.join(
  E2E_ROOT,
  "node_modules",
  "@playwright",
  "test",
  "cli.js"
);
const RESULTS_JSON = path.join(E2E_ROOT, "reports", "results.json");

const resultSchema = z.object({
  outcome: z.string(),
  summary: z.string(),
  draft: z
    .object({ file: z.string(), tier: z.string(), submitsForm: z.boolean() })
    .nullable(),
});

const annotationsSchema = z.object({
  suites: z.array(z.unknown()),
});

function runPlaywright(args: string[], env: NodeJS.ProcessEnv): number {
  const result = spawnSync(
    process.execPath,
    [PLAYWRIGHT_CLI, "test", ...args],
    { cwd: E2E_ROOT, env, stdio: "inherit" }
  );
  return result.status ?? 1;
}

/** The arguments that are not options (and not an option's value). */
function positional(argv: string[]): string[] {
  const valued = new Set(["--env", "--verify"]);
  return argv.filter(
    (argument, index) =>
      !argument.startsWith("--") && !valued.has(argv[index - 1] ?? "")
  );
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

/** The outcomes of the ai_check annotations in the last JSON report. */
function aiCheckOutcomes(): string[] {
  if (!fs.existsSync(RESULTS_JSON)) {
    return [];
  }
  const report: unknown = JSON.parse(fs.readFileSync(RESULTS_JSON, "utf8"));
  if (!annotationsSchema.safeParse(report).success) {
    return [];
  }
  const outcomes: string[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node !== "object" || node === null) {
      return;
    }
    if (
      "type" in node &&
      node.type === "ai_check" &&
      "description" in node &&
      typeof node.description === "string"
    ) {
      const parsed = z
        .object({ outcome: z.string() })
        .safeParse(JSON.parse(node.description));
      if (parsed.success) {
        outcomes.push(parsed.data.outcome);
      }
    }
    Object.values(node).forEach(visit);
  };
  visit(report);
  return outcomes;
}

function verify(
  environmentName: string,
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
  for (let round = 1; round <= times; round += 1) {
    console.log(
      `\nVerifying the draft (${round}/${times}) on ${environmentName}…`
    );
    const status = runPlaywright(["--retries=0"], {
      ...process.env,
      E2E_ENV: environmentName,
      E2E_PROFILE: profile,
      E2E_TEST_FILE: draftFile,
      E2E_RUN_ID: newRunId(),
    });
    if (status !== 0) {
      return { verified: false, why: `verification run ${round} failed` };
    }
    const unjudged = aiCheckOutcomes().filter((outcome) => outcome !== "pass");
    if (unjudged.length > 0) {
      return {
        verified: false,
        why: `an ai_check was not judged "pass" (${unjudged.join(", ")})`,
      };
    }
  }
  return { verified: true, why: `passed ${times} time(s) in a row` };
}

function save(environmentName: string, draftFile: string): string {
  const folder = buildEnvironment(environmentName).testsFolder ?? "authored";
  const target = path.join(TESTS_DIRECTORY, folder, path.basename(draftFile));
  if (fs.existsSync(target)) {
    throw new Error(
      `${path.relative(E2E_ROOT, target)} exists: not overwritten`
    );
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(draftFile, target);
  return path.relative(E2E_ROOT, target);
}

function main(): number {
  const argv = process.argv.slice(2);
  const environmentName = (
    optionValue(argv, "--env") ?? selectedEnvironmentName()
  ).toLowerCase();
  const goal = positional(argv).join(" ").trim();
  const times = Number(optionValue(argv, "--verify") ?? "1");
  if (goal === "") {
    console.error(
      'Usage: pnpm author [--env demo] "what to check" [--verify 2] [--save]'
    );
    return 2;
  }
  if (!Number.isInteger(times) || times < 1 || times > 5) {
    console.error("--verify takes 1 to 5");
    return 2;
  }

  if (buildEnvironment(environmentName).guarded) {
    console.error(
      `${environmentName} is guarded: write tests on another environment (e.g. staging); they run on ${environmentName} too`
    );
    return 2;
  }

  const id = newRunId();
  const folder = path.join(E2E_ROOT, "reports", "author", id);
  const status = runPlaywright([], {
    ...process.env,
    E2E_ENV: environmentName,
    E2E_AUTHOR_GOAL: goal,
    E2E_RUN_ID: id,
  });
  const resultFile = path.join(folder, "result.json");
  if (!fs.existsSync(resultFile)) {
    console.error(`\nThe author run wrote no result (exit ${status}).`);
    return 1;
  }
  const result = resultSchema.parse(
    JSON.parse(fs.readFileSync(resultFile, "utf8"))
  );
  console.log(`\nAuthor: ${result.outcome} — ${result.summary}`);
  if (result.draft === null) {
    return 1;
  }

  const draftFile = path.join(folder, result.draft.file);
  console.log(
    `Draft: ${path.relative(E2E_ROOT, draftFile)} (${result.draft.tier})`
  );
  const verification = verify(
    environmentName,
    draftFile,
    result.draft.tier,
    times
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
  if (argv.includes("--save")) {
    console.log(`Saved: ${save(environmentName, draftFile)}`);
  }
  return 0;
}

process.exitCode = main();
