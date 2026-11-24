import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { refuseByAvoid, refuseGoto } from "./guards";
import { AUTHOR_STEP_KEYWORDS, authorTools } from "./tools";

const AVOID = ["delete", "sign out", "pay"];

describe("author guards", () => {
  test("a relative goto passes", () => {
    assert.equal(refuseGoto("/pricing", "https://edplay.ai"), null);
  });

  test("an absolute goto on the same origin passes", () => {
    assert.equal(
      refuseGoto("https://edplay.ai/about", "https://edplay.ai"),
      null
    );
  });

  test("a goto to another origin is refused", () => {
    assert.match(
      refuseGoto("https://calendly.com/x", "https://edplay.ai") ?? "",
      /calendly\.com/
    );
  });

  test("an avoid word refuses the target", () => {
    assert.ok(refuseByAvoid("Delete account", AVOID) !== null);
    assert.ok(refuseByAvoid("SIGN OUT", AVOID) !== null);
  });

  test("avoid words match whole words only", () => {
    assert.equal(refuseByAvoid("Deleted items", AVOID), null);
    assert.equal(refuseByAvoid("Payroll report", AVOID), null);
  });
});

describe("author tools", () => {
  const tools = authorTools();

  test("one tool per author step, and finish", () => {
    assert.deepEqual(
      tools.map((tool) => tool.name).sort(),
      [...AUTHOR_STEP_KEYWORDS, "finish"].sort()
    );
  });

  test("every tool has an object schema and a description", () => {
    for (const tool of tools) {
      assert.equal(tool.schema.type, "object", tool.name);
      assert.ok(tool.description.length > 10, tool.name);
    }
  });

  test("no tool schema carries a $schema key (strict servers refuse it)", () => {
    for (const tool of tools) {
      assert.ok(!JSON.stringify(tool.schema).includes('"$schema"'), tool.name);
    }
  });

  test("no tool for track or setups", () => {
    assert.ok(!tools.some((tool) => tool.name === "track"));
  });
});
