import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { aiChecksVerdict, parseAuthorArgs } from "./verify";

describe("pnpm author's arguments", () => {
  test("--name value and --name=value both work", () => {
    assert.deepEqual(
      parseAuthorArgs(["--env=demo", "the", "menu", "--verify", "2", "--save"]),
      {
        environment: "demo",
        goal: "the menu",
        verify: 2,
        save: true,
      }
    );
    assert.equal(
      parseAuthorArgs(["--env", "staging", "x"]).environment,
      "staging"
    );
  });

  test("an unknown option or a bad --verify is refused", () => {
    assert.throws(() => parseAuthorArgs(["--evn", "demo", "x"]), /--evn/);
    assert.throws(() => parseAuthorArgs(["--verify=9", "x"]), /verify/);
  });
});

describe("ai_check annotations of a verification", () => {
  const note = (outcome: string): { type: string; description: string } => ({
    type: "ai_check",
    description: JSON.stringify({ outcome }),
  });

  test("all judged pass", () => {
    assert.equal(aiChecksVerdict([note("pass"), { type: "other" }], 1), null);
  });

  test("one not judged pass, or one missing", () => {
    assert.match(aiChecksVerdict([note("unsure")], 1) ?? "", /unsure/);
    assert.ok(aiChecksVerdict([], 1) !== null);
  });
});
