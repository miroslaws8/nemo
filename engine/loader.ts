import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { loadE2eConfig } from "./config";
import { environmentVariables } from "./environment";
import { normalizeSteps } from "./normalize";
import { E2E_ROOT } from "./paths";
import {
  eachSchema,
  parseDuration,
  rowsSchema,
  testFileSchema,
  testSchema,
} from "./schema";
import { SETUPS_BY_NAME } from "./setups";
import { STEPS_BY_KEYWORD } from "./steps";
import { loadTemplates } from "./templates";
import type {
  IEnvironment,
  INormalizeScope,
  ISetupCall,
  IStepNode,
  ITemplateDefinition,
  ITestCase,
  ITestSuite,
  IVariables,
  IYamlDocument,
} from "./types";
import { interpolate } from "./variables";
import { readYamlDocument } from "./yaml-document";

const TESTS_DIRECTORY = path.join(E2E_ROOT, "tests");
const TEST_FILE_PATTERN = /\.test\.ya?ml$/;
const DEFAULT_TEST_TIMEOUT_MS = 5 * 60_000;

function findTestFiles(): string[] {
  return fs
    .readdirSync(TESTS_DIRECTORY, { recursive: true, encoding: "utf8" })
    .filter((entry) => TEST_FILE_PATTERN.test(entry))
    .sort()
    .map((entry) => path.join(TESTS_DIRECTORY, entry));
}

function readRows(
  relativePath: string,
  file: string
): Record<string, unknown>[] {
  const rowsPath = path.join(E2E_ROOT, relativePath);
  if (!fs.existsSync(rowsPath)) {
    throw new Error(
      `${file}: each.from "${relativePath}" does not exist (paths are relative to the repo root)`
    );
  }

  const rows = rowsSchema.safeParse(
    readYamlDocument(rowsPath, relativePath).data
  );
  if (!rows.success) {
    throw new Error(`${relativePath}: ${z.prettifyError(rows.error)}`);
  }
  return rows.data;
}

function loadRows(
  each: z.infer<typeof eachSchema>,
  file: string
): IVariables[] {
  if (each.items !== undefined) {
    return each.items.map((item) => ({ [each.as]: item }));
  }
  if (each.from === undefined) {
    throw new Error(`${file}: each needs "from" or "items"`);
  }
  return readRows(each.from, file).map((item) => ({ [each.as]: item }));
}

function buildTestCase(
  testDefinition: z.infer<typeof testSchema>,
  testIndex: number,
  rowVariables: IVariables,
  setup: ISetupCall[],
  environment: IEnvironment,
  scope: INormalizeScope
): ITestCase {
  const titleVariables = {
    env: environmentVariables(environment),
    ...rowVariables,
  };

  return {
    title: String(
      interpolate(testDefinition.name, titleVariables, { strict: false })
    ),
    file: scope.file,
    setup,
    timeoutMs: parseDuration(testDefinition.timeout, DEFAULT_TEST_TIMEOUT_MS),
    skip: testDefinition.skip ?? false,
    only: testDefinition.only ?? false,
    steps: normalizeSteps(
      testDefinition.steps,
      ["tests", testIndex, "steps"],
      scope
    ),
    variables: rowVariables,
  };
}

function singleEntry(
  entry: Record<string, unknown>,
  where: string
): [string, unknown] {
  const [first, ...others] = Object.entries(entry);
  if (first === undefined || others.length > 0) {
    throw new Error(`${where}: a setup is a name, or { name: { ...params } }`);
  }
  return first;
}

// `setup:` entries are a bare name or { name: { ...params } }; params are checked here, once.
function normalizeSetupCalls(
  entries: z.infer<typeof testFileSchema>["setup"],
  file: string
): ISetupCall[] {
  return entries.map((entry, index) => {
    const where = `${file} › setup[${index}]`;
    const [name, rawArgs] =
      typeof entry === "string" ? [entry, null] : singleEntry(entry, where);
    const setup = SETUPS_BY_NAME.get(name);
    if (setup === undefined) {
      const known = [...SETUPS_BY_NAME.keys()].join(", ");
      throw new Error(
        `${where}: unknown setup "${name}" — known setups: ${known}`
      );
    }

    const args = rawArgs ?? {};
    const validation = setup.params.safeParse(args);
    if (!validation.success) {
      throw new Error(
        `${where} (${name}): ${z.prettifyError(validation.error)}`
      );
    }
    return { name, args };
  });
}

function checkTierExists(tierName: string, file: string): void {
  const tiers = loadE2eConfig().tiers;
  if (tiers[tierName] === undefined) {
    const known = Object.keys(tiers).join(", ");
    throw new Error(
      `${file}: unknown tier "${tierName}" — e2e.config.yaml defines: ${known}`
    );
  }
}

function stepsCreateData(
  steps: IStepNode[],
  templates: ReadonlyMap<string, ITemplateDefinition>
): boolean {
  return steps.some((step) => {
    switch (step.kind) {
      case "action":
        return STEPS_BY_KEYWORD.get(step.keyword)?.createsData === true;
      case "template": {
        const template = templates.get(step.template);
        return (
          template !== undefined && stepsCreateData(template.steps, templates)
        );
      }
      case "repeat":
        return stepsCreateData(step.steps, templates);
      default: {
        const unknownStep: never = step;
        return Boolean(unknownStep);
      }
    }
  });
}

// A read-only tier also runs as the prod monitor, so nothing in it may create data: no creating
// setup, and no step (directly or inside a template) that registers data for cleanup.
function checkReadOnlyTier(
  tierName: string,
  setupCalls: ISetupCall[],
  cases: ITestCase[],
  file: string,
  templates: ReadonlyMap<string, ITemplateDefinition>
): void {
  if (!loadE2eConfig().tiers[tierName].read_only) {
    return;
  }

  const creatingSetups = setupCalls
    .filter((call) => SETUPS_BY_NAME.get(call.name)?.mode === "creates")
    .map((call) => call.name);
  if (creatingSetups.length > 0) {
    throw new Error(
      `${file}: tier "${tierName}" is read-only, but setup ${creatingSetups.join(
        ", "
      )} creates data — use a tier that may write`
    );
  }
  if (cases.some((testCase) => stepsCreateData(testCase.steps, templates))) {
    throw new Error(
      `${file}: tier "${tierName}" is read-only, but a step registers created data (track) — use a tier that may write`
    );
  }
}

// A test list (how the console retries tests) splits a full test title on this character.
const TITLE_SEPARATOR = "›";

function checkTitles(suite: string, cases: ITestCase[], file: string): void {
  const offending = [suite, ...cases.map((testCase) => testCase.title)].find(
    (title) => title.includes(TITLE_SEPARATOR)
  );
  if (offending !== undefined) {
    throw new Error(
      `${file}: "${offending}" — "${TITLE_SEPARATOR}" separates titles in a test list (retries); use another character`
    );
  }
}

/** Turns one parsed test file into test cases; `file` is how it is named in messages. */
export function parseTestSuite(
  file: string,
  document: IYamlDocument,
  environment: IEnvironment
): ITestSuite {
  const parsed = testFileSchema.safeParse(document.data);
  if (!parsed.success) {
    throw new Error(`${file}: ${z.prettifyError(parsed.error)}`);
  }

  const definition = parsed.data;
  const setupCalls = normalizeSetupCalls(definition.setup, file);
  checkTierExists(definition.tier, file);

  const templates = loadTemplates();
  const scope: INormalizeScope = {
    file,
    document,
    templates,
    declaredParams: null,
  };
  const rows =
    definition.each === undefined ? [{}] : loadRows(definition.each, file);
  const cases = rows.flatMap((rowVariables) =>
    definition.tests.map((testDefinition, testIndex) =>
      buildTestCase(
        testDefinition,
        testIndex,
        rowVariables,
        setupCalls,
        environment,
        scope
      )
    )
  );
  checkReadOnlyTier(definition.tier, setupCalls, cases, file, templates);
  checkTitles(definition.suite, cases, file);

  return {
    file,
    suite: definition.suite,
    tier: definition.tier,
    tags: definition.tags,
    cases,
  };
}

/** Reads every tests/**\/*.test.yaml; a malformed file fails the whole run with its location. */
export function loadTestSuites(environment: IEnvironment): ITestSuite[] {
  return findTestFiles().map((filePath) => {
    const file = path.relative(E2E_ROOT, filePath);
    return parseTestSuite(file, readYamlDocument(filePath, file), environment);
  });
}
