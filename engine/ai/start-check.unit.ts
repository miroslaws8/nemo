import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { aiStartProblem, stepsUse } from "./start-check";
import type { IAiSettings, IStepNode, ITemplateDefinition } from "../types";

const KEY = "QA_AI_START_CHECK_KEY";

const SETTINGS: IAiSettings = {
  models: {
    fast: {
      protocol: "openai",
      model: "m-1",
      baseUrl: null,
      keyVariable: KEY,
      vision: true,
      usdPerMillion: { input: 1, output: 1 },
      params: {},
    },
  },
  judge: {
    model: "fast",
    escalateTo: null,
    minConfidence: 0.7,
    retries: 2,
    blocking: true,
  },
  budgetUsdPerRun: 1,
  author: null,
};

const LOCATION = { file: "t.yaml", line: 1, label: "t.yaml:1" };

function action(keyword: string): IStepNode {
  return {
    kind: "action",
    keyword,
    args: "x",
    position: 0,
    location: LOCATION,
  };
}

describe("the AI start check", () => {
  test("stops a CI run whose tests ask the judge without its key", () => {
    delete process.env[KEY];
    assert.match(
      aiStartProblem(SETTINGS, true, true) ?? "",
      /ai\.models\.fast\.key: QA_AI_START_CHECK_KEY is not set/
    );
  });

  test("lets it go without an ai_check, outside CI, with AI off, or with the key", () => {
    delete process.env[KEY];
    assert.equal(aiStartProblem(SETTINGS, false, true), null);
    assert.equal(aiStartProblem(SETTINGS, true, false), null);
    assert.equal(aiStartProblem(null, true, true), null);
    process.env[KEY] = "secret";
    assert.equal(aiStartProblem(SETTINGS, true, true), null);
  });

  test("a missing escalation key does not stop the run", () => {
    process.env[KEY] = "secret";
    delete process.env.QA_AI_START_CHECK_STRONG_KEY;
    const withEscalation: IAiSettings = {
      ...SETTINGS,
      models: {
        ...SETTINGS.models,
        strong: {
          ...SETTINGS.models.fast,
          keyVariable: "QA_AI_START_CHECK_STRONG_KEY",
        },
      },
      judge: { ...SETTINGS.judge, escalateTo: "strong" },
    };
    assert.equal(aiStartProblem(withEscalation, true, true), null);
  });

  test("finds ai_check inside a repeat and a template", () => {
    const templates = new Map<string, ITemplateDefinition>();
    assert.equal(stepsUse([action("goto")], "ai_check", templates), false);
    const repeat: IStepNode = {
      kind: "repeat",
      until: { text: "Done" },
      max: 3,
      steps: [action("ai_check")],
      position: 0,
      location: LOCATION,
    };
    assert.equal(stepsUse([repeat], "ai_check", templates), true);
  });
});
