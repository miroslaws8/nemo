import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildEnvironment } from "./environment";
import { loadTestSuites } from "./loader";

test("E2E_TEST_FILE loads only that file, wherever it is", () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "draft-"));
  const file = path.join(folder, "draft.test.yaml");
  fs.writeFileSync(
    file,
    [
      "suite: A draft",
      "tier: smoke",
      "tests:",
      "  - name: opens",
      "    steps:",
      "      - goto: /",
    ].join("\n")
  );
  const demo = buildEnvironment("demo");
  try {
    process.env.E2E_TEST_FILE = file;
    const suites = loadTestSuites(demo);
    assert.deepEqual(
      suites.map((suite) => suite.suite),
      ["A draft"]
    );
  } finally {
    delete process.env.E2E_TEST_FILE;
  }
  assert.ok(loadTestSuites(demo).length > 1);
});
