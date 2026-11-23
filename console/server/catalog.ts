import { z } from "zod";
import type { ICatalogTest } from "../shared/types";
import { HttpError } from "./http-error";
import { runCommand } from "./process-control";
import { isLoginProject, testListLine } from "../shared/test-list";
import type { IPreparedRun } from "./types";

// The tests a run can select: `playwright test --list --reporter=json` for one environment and
// profile, where the tests are (the working tree, or a snapshot of a commit). Listing reads every
// YAML file: the workspaces keep what they listed.

interface IJsonSpec {
  id: string;
  title: string;
  tags: string[];
  tests: {
    projectName: string;
    annotations: { type: string; description?: string }[];
  }[];
}

interface IJsonSuite {
  title: string;
  specs: IJsonSpec[];
  suites?: IJsonSuite[];
}

const jsonSpecSchema = z.object({
  id: z.string(),
  title: z.string(),
  tags: z.array(z.string()).default([]),
  tests: z.array(
    z.object({
      projectName: z.string(),
      annotations: z
        .array(
          z.object({ type: z.string(), description: z.string().optional() })
        )
        .default([]),
    })
  ),
});

const jsonSuiteSchema: z.ZodType<IJsonSuite> = z.lazy(() =>
  z.object({
    title: z.string(),
    specs: z.array(jsonSpecSchema).default([]),
    suites: z.array(jsonSuiteSchema).optional(),
  })
);

const jsonListSchema = z.object({ suites: z.array(jsonSuiteSchema) });

function collect(
  suite: IJsonSuite,
  spec: string,
  describe: string,
  into: ICatalogTest[]
): void {
  for (const jsonSpec of suite.specs) {
    for (const test of jsonSpec.tests) {
      if (isLoginProject(test.projectName)) {
        continue;
      }
      const entry = {
        testId: jsonSpec.id,
        project: test.projectName,
        spec,
        file:
          test.annotations.find((annotation) => annotation.type === "file")
            ?.description ?? null,
        suite: describe,
        title: jsonSpec.title,
        tags: jsonSpec.tags,
      };
      into.push({ ...entry, listLine: testListLine(entry) });
    }
  }
  for (const child of suite.suites ?? []) {
    collect(child, spec, child.title, into);
  }
}

/** Lists the tests where `place` says (its env has E2E_ENV and E2E_PROFILE, no run folder). */
export async function listTests(place: IPreparedRun): Promise<ICatalogTest[]> {
  const result = await runCommand(
    place.playwright(["test", "--list", "--reporter=json"]),
    place.cwd,
    place.env
  );

  let parsed: z.infer<typeof jsonListSchema>;
  try {
    parsed = jsonListSchema.parse(JSON.parse(result.stdout));
  } catch {
    throw new HttpError(
      500,
      `could not list the tests: ${
        result.stderr.trim().slice(0, 500) || "no output"
      }`
    );
  }
  const tests: ICatalogTest[] = [];
  for (const fileSuite of parsed.suites) {
    collect(fileSuite, fileSuite.title, "", tests);
  }
  return tests;
}
