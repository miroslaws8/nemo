import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { judgeAnswerSchema, parseJsonAnswer } from "./json-answer";

const VALID = {
  verdict: "pass",
  confidence: 0.9,
  reason: "the menu is open",
};

describe("parseJsonAnswer", () => {
  test("plain JSON", () => {
    const answer = parseJsonAnswer(JSON.stringify(VALID), judgeAnswerSchema);
    assert.deepEqual(answer, { ...VALID, regions: [] });
  });

  test("JSON in a fence, with prose around it", () => {
    const text = `Looking at the page:\n\`\`\`json\n${JSON.stringify(
      VALID
    )}\n\`\`\`\nThat is my answer.`;
    assert.equal(parseJsonAnswer(text, judgeAnswerSchema)?.verdict, "pass");
  });

  test("a confidence in percent is not an answer", () => {
    const text = JSON.stringify({ ...VALID, confidence: 85 });
    assert.equal(parseJsonAnswer(text, judgeAnswerSchema), null);
  });

  test("no JSON at all", () => {
    assert.equal(
      parseJsonAnswer("The page looks fine.", judgeAnswerSchema),
      null
    );
  });

  test("look_at is kept", () => {
    const text = JSON.stringify({
      ...VALID,
      verdict: "unsure",
      look_at: "Starter $50",
    });
    assert.equal(
      parseJsonAnswer(text, judgeAnswerSchema)?.look_at,
      "Starter $50"
    );
  });

  test("regions are kept", () => {
    const text = JSON.stringify({
      ...VALID,
      verdict: "fail",
      regions: [{ x: 1, y: 2, width: 30, height: 40, note: "cut off" }],
    });
    assert.equal(parseJsonAnswer(text, judgeAnswerSchema)?.regions.length, 1);
  });
});
