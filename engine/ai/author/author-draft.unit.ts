import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parse } from "yaml";
import { buildEnvironment } from "../../environment";
import { forEnvironment, parseTestSuite } from "../../loader";
import { parseYamlText } from "../../yaml-document";
import { draftTest } from "./draft";

const demo = buildEnvironment("demo");
const staging = buildEnvironment("staging");

const LOOKING = [
  { keyword: "goto", args: "/", submits: false },
  { keyword: "click", args: { button: "Open menu" }, submits: false },
  {
    keyword: "click",
    args: { role: "link", name: "Pricing", in: "dialog" },
    submits: false,
  },
  { keyword: "expect_url", args: { contains: "/pricing" }, submits: false },
];

describe("the author's draft", () => {
  test("a looking-only draft is smoke, keeps its steps in order, and parses", () => {
    const draft = draftTest(
      "on a phone, the menu leads to the pricing page",
      "the menu leads to pricing",
      LOOKING,
      demo,
      false
    );
    assert.equal(draft.tier, "smoke");
    assert.equal(draft.submitsForm, false);
    const data: unknown = parse(draft.yaml);
    assert.ok(typeof data === "object" && data !== null && "tests" in data);
    const suite = parseTestSuite(
      "draft",
      parseYamlText(draft.yaml, "draft"),
      demo
    );
    assert.equal(suite.tier, "smoke");
    assert.deepEqual(suite.tags, ["authored"]);
    assert.equal(suite.environments, null);
    assert.equal(suite.cases[0].title, "the menu leads to pricing");
    assert.match(
      draft.yaml,
      /goto: \/\n[\s\S]*Open menu[\s\S]*Pricing[\s\S]*\/pricing/
    );
  });

  test("a submitted form makes a writes draft limited to its environment", () => {
    const draft = draftTest(
      "the contact form is sent",
      "the contact form sends",
      [
        { keyword: "goto", args: "/contact", submits: false },
        {
          keyword: "fill",
          args: { label: "Message", value: "Hello" },
          submits: false,
        },
        { keyword: "click", args: { button: "Send" }, submits: true },
      ],
      staging,
      true
    );
    assert.equal(draft.tier, "regression");
    assert.equal(draft.submitsForm, true);
    assert.match(draft.yaml, /not cleaned up/);
    const suite = parseTestSuite(
      "draft",
      parseYamlText(draft.yaml, "draft"),
      staging
    );
    assert.deepEqual(suite.tags, ["authored", "writes"]);
    assert.deepEqual(suite.environments, ["staging"]);
  });

  test("a submitted form where writes are not allowed is refused", () => {
    assert.throws(
      () =>
        draftTest(
          "send it",
          "sends",
          [{ keyword: "click", args: { button: "Send" }, submits: true }],
          demo,
          false
        ),
      /writes/
    );
  });

  test("the slug is kebab-case and short; › never reaches the suite", () => {
    const draft = draftTest(
      "On a phone › the Menu leads to the PRICING page, and every plan's price is readable on it",
      "menu",
      LOOKING,
      demo,
      false
    );
    assert.match(draft.slug, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.ok(draft.slug.length <= 60);
    assert.ok(!draft.yaml.includes("›"));
  });
});

describe("environments of a test file", () => {
  test("a suite limited to staging is left out elsewhere", () => {
    const yaml = [
      "suite: Staging only",
      "tier: smoke",
      "environments: [staging]",
      "tests:",
      "  - name: opens",
      "    steps:",
      "      - goto: /",
    ].join("\n");
    const suite = parseTestSuite("t", parseYamlText(yaml, "t"), demo);
    assert.equal(forEnvironment([suite], demo).length, 0);
    assert.equal(forEnvironment([suite], staging).length, 1);
  });
});
