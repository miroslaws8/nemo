import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseAuthorArgs, verificationVerdict } from "./verify";

function report(
  stats: {
    expected: number;
    unexpected: number;
    flaky: number;
    skipped: number;
  },
  outcomes: string[]
): unknown {
  return {
    stats,
    suites: [
      {
        specs: [
          {
            tests: [
              {
                annotations: outcomes.map((outcome) => ({
                  type: "ai_check",
                  description: JSON.stringify({ outcome }),
                })),
              },
            ],
          },
        ],
      },
    ],
  };
}

const PASSED = { expected: 1, unexpected: 0, flaky: 0, skipped: 0 };

describe("verification", () => {
  test("passes when the draft's test passed and every ai_check was judged pass", () => {
    assert.equal(verificationVerdict(report(PASSED, ["pass"]), 1), null);
  });

  test("no report, a failed or flaky or skipped test fails it", () => {
    assert.match(verificationVerdict(null, 0) ?? "", /no report/);
    assert.ok(
      verificationVerdict(
        report({ ...PASSED, expected: 0, unexpected: 1 }, []),
        0
      ) !== null
    );
    assert.ok(
      verificationVerdict(report({ ...PASSED, flaky: 1 }, []), 0) !== null
    );
    assert.ok(
      verificationVerdict(
        report({ ...PASSED, expected: 0, skipped: 1 }, []),
        0
      ) !== null
    );
  });

  test("an ai_check not judged pass, or missing, fails it", () => {
    assert.match(
      verificationVerdict(report(PASSED, ["unsure"]), 1) ?? "",
      /unsure/
    );
    assert.ok(verificationVerdict(report(PASSED, []), 1) !== null);
  });
});

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
