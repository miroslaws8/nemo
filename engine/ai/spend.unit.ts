import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { runSpend } from "./spend";

function tempFile(): string {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "ai-spend-"));
  return path.join(folder, "spend.ndjson");
}

describe("run spend", () => {
  test("adds and totals", () => {
    const spend = runSpend(tempFile());
    assert.equal(spend.total(), 0);
    spend.add(0.25, "m-1");
    spend.add(0.5, "m-2");
    assert.equal(spend.total(), 0.75);
  });

  test("budget across writers: every worker sees the others' spend", () => {
    const file = tempFile();
    const workerA = runSpend(file);
    const workerB = runSpend(file);
    workerA.add(1.2, "m-1");
    workerB.add(1.2, "m-1");
    assert.equal(workerA.total(), 2.4);
    assert.equal(workerB.total(), 2.4);
  });
});
