import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { z } from "zod";
import { loadE2eConfig } from "../config";
import { buildEnvironment } from "../environment";
import { buildJsonSchemaFiles } from "../json-schemas";
import { loadTestSuites, parseTestSuite } from "../loader";
import { E2E_ROOT } from "../paths";
import { resolveRun } from "../run-selection";
import { renderScaffold, scaffoldPath } from "../scaffolds";
import { buildSkillFiles, findBrokenSkillTemplates } from "../skills";
import { loadTemplates } from "../templates";
import { parseYamlText } from "../yaml-document";

// Offline checks for a pull request: no browser, no network, no credentials.

const PACKAGE_PATH = path.join(E2E_ROOT, "package.json");
// What runs on a Playwright image: CI, and the server QA console.
const IMAGE_FILES = ["bitbucket-pipelines.yml", "Dockerfile"];
const PLAYWRIGHT_IMAGE_PATTERN =
  /mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)/g;
const EXACT_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

const packageSchema = z.object({
  devDependencies: z.record(z.string(), z.string()),
});

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Every template and test file must load on every environment, and every profile must resolve.
function summarizeRuns(): string[] {
  const config = loadE2eConfig();
  const lines = [`templates: ${[...loadTemplates().keys()].join(", ")}`];

  for (const environmentName of Object.keys(config.environments)) {
    const suites = loadTestSuites(buildEnvironment(environmentName));
    for (const profileName of Object.keys(config.profiles)) {
      const run = resolveRun(environmentName, profileName);
      const counts = run.tiers.map((tier) => {
        const testCount = suites
          .filter((suite) => suite.tier === tier.name)
          .reduce((total, suite) => total + suite.cases.length, 0);
        return `${tier.name} ${testCount}`;
      });
      lines.push(`${environmentName} × ${profileName}: ${counts.join(", ")}`);
    }
  }
  return lines;
}

// `pnpm new` copies these, so each must still turn into a valid test of its own tier.
function findBrokenScaffolds(): string[] {
  const config = loadE2eConfig();
  const environment = buildEnvironment(Object.keys(config.environments)[0]);
  const problems: string[] = [];

  for (const tierName of Object.keys(config.tiers)) {
    const source = scaffoldPath(tierName);
    if (!fs.existsSync(source)) {
      continue;
    }
    const label = path.relative(E2E_ROOT, source);
    const target = path.join(E2E_ROOT, "tests", tierName, "example.test.yaml");
    try {
      const suite = parseTestSuite(
        label,
        parseYamlText(renderScaffold(tierName, "Example", target), label),
        environment
      );
      if (suite.tier !== tierName) {
        problems.push(`${label}: declares tier "${suite.tier}"`);
      }
    } catch (error) {
      problems.push(describeError(error));
    }
  }
  return problems;
}

function findStaleSchemas(): string[] {
  return buildJsonSchemaFiles()
    .filter(
      (file) =>
        !fs.existsSync(file.path) ||
        fs.readFileSync(file.path, "utf8") !== file.content
    )
    .map(
      (file) =>
        `${path.relative(E2E_ROOT, file.path)} is out of date — run pnpm schema`
    );
}

// Hermes reads each skill's SKILL.md, written from its skill.yaml and the shared template.
function findStaleSkills(): string[] {
  const { files, problems } = buildSkillFiles();
  return [
    ...problems,
    ...files
      .filter(
        (file) =>
          !fs.existsSync(file.path) ||
          fs.readFileSync(file.path, "utf8") !== file.content
      )
      .map(
        (file) =>
          `${path.relative(
            E2E_ROOT,
            file.path
          )} is out of date — run pnpm skills`
      ),
  ];
}

// The helper skills load into the page to mark it for screenshots: it must at least parse.
function findBrokenMarkHelper(): string[] {
  const file = path.join(E2E_ROOT, "hermes", "qa-mark.js");
  try {
    new vm.Script(fs.readFileSync(file, "utf8"), { filename: file });
    return [];
  } catch (error) {
    return [`hermes/qa-mark.js: ${describeError(error)}`];
  }
}

// The browsers come from the Playwright Docker image, so its tag must equal @playwright/test in
// package.json.
function findPlaywrightVersionProblems(): string[] {
  const packageJson = packageSchema.parse(
    JSON.parse(fs.readFileSync(PACKAGE_PATH, "utf8"))
  );
  const pinned = packageJson.devDependencies["@playwright/test"] ?? "";
  if (!EXACT_VERSION_PATTERN.test(pinned)) {
    return [
      `package.json: pin @playwright/test to an exact version (found "${pinned}")`,
    ];
  }
  return IMAGE_FILES.filter((file) =>
    fs.existsSync(path.join(E2E_ROOT, file))
  ).flatMap((file) =>
    [
      ...fs
        .readFileSync(path.join(E2E_ROOT, file), "utf8")
        .matchAll(PLAYWRIGHT_IMAGE_PATTERN),
    ]
      .map((match) => match[1])
      .filter((imageVersion) => imageVersion !== pinned)
      .map(
        (imageVersion) =>
          `${file} uses playwright:v${imageVersion}, package.json pins ${pinned}`
      )
  );
}

// Each check reports on its own, so one broken file does not hide the other problems.
function runCheck(check: () => string[]): string[] {
  try {
    return check();
  } catch (error) {
    return [describeError(error)];
  }
}

function main(): void {
  const problems = runCheck(() => {
    for (const line of summarizeRuns()) {
      console.log(line);
    }
    return [];
  });
  problems.push(
    ...runCheck(findBrokenScaffolds),
    ...runCheck(findStaleSchemas),
    ...runCheck(findStaleSkills),
    ...runCheck(findBrokenSkillTemplates),
    ...runCheck(findBrokenMarkHelper),
    ...runCheck(findPlaywrightVersionProblems)
  );

  if (problems.length > 0) {
    // A broken template surfaces in several checks; report it once.
    for (const problem of new Set(problems)) {
      console.error(`✗ ${problem}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log("✓ config, tests, schemas, skills and skill templates are valid");
}

main();
