import assert from "node:assert/strict";
import { test } from "node:test";
import { stepLogLine } from "../runner";
import { STEPS_BY_KEYWORD } from "./index";

test("ai_check is not replayed after a rate limit (it would be paid again)", () => {
  assert.equal(STEPS_BY_KEYWORD.get("ai_check")?.observesOnly, false);
});

test("the step log keeps a step as written, not its values", () => {
  const line = stepLogLine({
    kind: "action",
    keyword: "fill",
    args: { css: "#password", value: "${secret.password}" },
    position: 0,
    location: { file: "t.yaml", line: 1, label: "t.yaml:1" },
  });
  assert.match(line, /\$\{secret\.password\}/);
});
