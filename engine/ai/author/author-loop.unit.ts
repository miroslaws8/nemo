import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { authorCase } from "./loop";
import type {
  IAuthorDeps,
  IEvidence,
  IModelClient,
  IModelReply,
  IModelRequest,
  IModelToolCall,
} from "../../types";

type IQueued = IModelToolCall[] | string | Error;

let callNumber = 0;

function call(name: string, input: unknown): IModelToolCall {
  callNumber += 1;
  return { id: `call_${callNumber}`, name, input };
}

function stubClient(queue: IQueued[]): IModelClient & {
  requests: IModelRequest[];
} {
  const requests: IModelRequest[] = [];
  return {
    role: "fast",
    model: "m-1",
    requests,
    async complete(request): Promise<IModelReply> {
      requests.push(request);
      const next = queue.shift();
      if (next === undefined) {
        throw new Error("no more replies queued");
      }
      if (next instanceof Error) {
        throw next;
      }
      return {
        text: typeof next === "string" ? next : "",
        toolCalls: typeof next === "string" ? [] : next,
        usage: { inputTokens: 1, outputTokens: 1 },
        refused: false,
      };
    },
  };
}

const EVIDENCE: IEvidence = {
  png: Buffer.from([1]),
  aria: '- heading "Home"',
  url: "https://example.com/",
  top: 0,
  focus: null,
};

function stubAct(
  failing: string[] = [],
  submitting: string[] = []
): {
  act: IAuthorDeps["act"];
  ran: string[];
} {
  const ran: string[] = [];
  return {
    ran,
    act: async (step) => {
      const label = `${step.keyword} ${JSON.stringify(step.args)}`;
      ran.push(label);
      return {
        error: failing.includes(label) ? `${label} failed` : null,
        submits: submitting.includes(label),
      };
    },
  };
}

const DONE = call("finish", {
  outcome: "done",
  summary: "the menu leads to pricing",
});

function run(
  queue: IQueued[],
  act: ReturnType<typeof stubAct>["act"],
  maxActions = 30
): ReturnType<typeof authorCase> {
  return authorCase("the menu leads to pricing", {
    client: stubClient(queue),
    observe: async () => EVIDENCE,
    act,
    maxActions,
  });
}

describe("the author loop", () => {
  test("keeps successful steps in order and finishes", async () => {
    const { act, ran } = stubAct();
    const result = await run(
      [
        [call("goto", { args: "/" })],
        [call("click", { args: { button: "Open menu" } })],
        [call("expect_url", { args: { contains: "/pricing" } }), DONE],
      ],
      act
    );
    assert.equal(result.outcome, "done");
    assert.equal(result.summary, "the menu leads to pricing");
    assert.deepEqual(
      result.kept.map((step) => step.keyword),
      ["goto", "click", "expect_url"]
    );
    assert.equal(ran.length, 3);
  });

  test("drops a failed step and goes on", async () => {
    const { act } = stubAct(['click {"button":"Menu"}']);
    const result = await run(
      [
        [call("click", { args: { button: "Menu" } })],
        [call("click", { args: { button: "Open menu" } }), DONE],
      ],
      act
    );
    assert.deepEqual(result.kept, [
      { keyword: "click", args: { button: "Open menu" }, submits: false },
    ]);
    assert.equal(result.turns[0].ok, false);
    assert.match(result.turns[0].result, /failed/);
  });

  test("keeps whether a step submitted a form", async () => {
    const { act } = stubAct([], ['click {"button":"Send"}']);
    const result = await run(
      [[call("click", { args: { button: "Send" } }), DONE]],
      act
    );
    assert.equal(result.kept[0].submits, true);
  });

  test("finish impossible keeps its outcome", async () => {
    const { act } = stubAct();
    const result = await run(
      [
        [
          call("finish", {
            outcome: "impossible",
            summary: "there is no menu",
          }),
        ],
      ],
      act
    );
    assert.equal(result.outcome, "impossible");
    assert.equal(result.summary, "there is no menu");
  });

  test("an unknown tool and malformed input are tool errors; nothing runs", async () => {
    const { act, ran } = stubAct();
    const client = stubClient([
      [
        call("track", { args: {} }),
        call("click", "{not json"),
        call("goto", { nope: 1 }),
      ],
      [DONE],
    ]);
    const result = await authorCase("goal", {
      client,
      observe: async () => EVIDENCE,
      act,
      maxActions: 30,
    });
    assert.equal(ran.length, 0);
    assert.equal(result.turns.filter((turn) => !turn.ok).length, 3);
    const toolMessage = client.requests[1].messages.find(
      (message) => message.role === "tool"
    );
    assert.ok(toolMessage !== undefined && toolMessage.role === "tool");
    assert.equal(toolMessage.results.length, 3);
  });

  test("stops at maxActions as incomplete", async () => {
    const { act } = stubAct();
    const result = await run(
      [
        [call("goto", { args: "/a" })],
        [call("goto", { args: "/b" })],
        [call("goto", { args: "/c" })],
      ],
      act,
      2
    );
    assert.equal(result.outcome, "incomplete");
    assert.equal(result.kept.length, 2);
  });

  test("text without a tool call twice ends incomplete", async () => {
    const { act } = stubAct();
    const result = await run(["I would click.", "Still thinking."], act);
    assert.equal(result.outcome, "incomplete");
  });

  test("a provider error ends incomplete with the error", async () => {
    const { act } = stubAct();
    const result = await run([new Error("503 overloaded")], act);
    assert.equal(result.outcome, "incomplete");
    assert.match(result.summary, /503/);
  });
});
