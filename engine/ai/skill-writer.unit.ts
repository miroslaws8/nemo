import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SKILL_NAME_MAX, SKILL_NAME_PATTERN } from "../skill-schema";
import {
  parseSkillAnswer,
  skillNameFrom,
  skillWriterRequest,
} from "./skill-writer";

const INPUT = {
  description:
    "On a phone, open every page from the menu and look for cut-off text",
  fields: [
    { field: "description", required: true, description: "What it checks" },
    { field: "steps", required: true, description: "What to do" },
  ],
  example: "description: An example skill\nsteps:\n  - Open the page\n",
  environments: ["demo", "staging"],
  problems: [],
  previous: null,
};

function userText(request: ReturnType<typeof skillWriterRequest>): string {
  return request.messages
    .flatMap((message) =>
      message.role === "user"
        ? message.parts.flatMap((part) =>
            part.type === "text" ? [part.text] : []
          )
        : []
    )
    .join("\n");
}

describe("the skill writer's request", () => {
  test("holds the description, every field and the example", () => {
    const request = skillWriterRequest(INPUT);
    const everything = `${request.system}\n${userText(request)}`;
    assert.match(everything, /look for cut-off text/);
    assert.match(everything, /description/);
    assert.match(everything, /steps/);
    assert.match(everything, /An example skill/);
    assert.match(everything, /demo, staging/);
    assert.deepEqual(request.tools, []);
  });

  test("a retry lists the problems of the last answer", () => {
    const request = skillWriterRequest({
      ...INPUT,
      problems: ["steps: at least one step", "fail_if: required"],
    });
    assert.match(
      userText(request),
      /at least one step[\s\S]*fail_if: required/
    );
  });
});

describe("a retry", () => {
  test("shows the model its previous skill.yaml", () => {
    const request = skillWriterRequest({
      ...INPUT,
      problems: ["steps.2: too long"],
      previous: "description: the first try\nsteps:\n  - a\n",
    });
    assert.match(userText(request), /the first try[\s\S]*steps\.2: too long/);
  });
});

describe("the skill writer's answer", () => {
  test("a fenced JSON answer is read", () => {
    const text =
      'Here it is:\n```json\n{"name": "qa-menu-pages", "yaml": "description: x\\nsteps:\\n  - y\\n"}\n```';
    assert.deepEqual(parseSkillAnswer(text), {
      name: "qa-menu-pages",
      yaml: "description: x\nsteps:\n  - y\n",
    });
  });

  test("an answer without yaml is no answer", () => {
    assert.equal(parseSkillAnswer('{"name": "qa-x"}'), null);
    assert.equal(parseSkillAnswer("I cannot do that."), null);
  });
});

describe("a skill name from a description", () => {
  test("qa- and kebab-case", () => {
    assert.equal(
      skillNameFrom("Check the pricing page on a phone!"),
      "qa-check-the-pricing-page-on-a-phone"
    );
  });

  test("long text stays a valid name", () => {
    const name = skillNameFrom(
      "Open every single page of the whole site from the menu on a small phone and report anything that looks broken or cut off"
    );
    assert.ok(name.length <= SKILL_NAME_MAX);
    assert.match(name, SKILL_NAME_PATTERN);
  });

  test("nothing usable still gives a valid name", () => {
    assert.match(skillNameFrom("!!! ???"), SKILL_NAME_PATTERN);
  });
});
