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
      requests.push(structuredClone(request));
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
  outcomes: Record<
    string,
    { error?: string; submits?: boolean; stop?: string }
  > = {}
): { act: IAuthorDeps["act"]; ran: string[] } {
  const ran: string[] = [];
  return {
    ran,
    act: async (step) => {
      const label = `${step.keyword} ${JSON.stringify(step.args)}`;
      ran.push(label);
      const outcome = outcomes[label] ?? {};
      return {
        error: outcome.error ?? null,
        submits: outcome.submits ?? false,
        stop: outcome.stop ?? null,
      };
    },
  };
}

const DONE = (): IModelToolCall =>
  call("finish", { outcome: "done", summary: "the menu leads to pricing" });

function run(
  queue: IQueued[],
  act: IAuthorDeps["act"],
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
        [call("expect_url", { args: { contains: "/pricing" } })],
        [DONE()],
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

  test("runs one tool per reply; the others are answered, not run", async () => {
    const { act, ran } = stubAct();
    const client = stubClient([
      [
        call("goto", { args: "/settings" }),
        call("click", { args: { button: "Delete" } }),
      ],
      [call("expect_visible", { args: { text: "Settings" } })],
      [DONE()],
    ]);
    await authorCase("goal", {
      client,
      observe: async () => EVIDENCE,
      act,
      maxActions: 30,
    });
    assert.deepEqual(ran, [
      'goto "/settings"',
      'expect_visible {"text":"Settings"}',
    ]);
    const tool = client.requests[1].messages.find(
      (message) => message.role === "tool"
    );
    assert.ok(tool !== undefined && tool.role === "tool");
    assert.equal(tool.results.length, 2);
    assert.match(tool.results[1].text, /one tool at a time/);
  });

  test("drops a failed step and goes on", async () => {
    const { act } = stubAct({
      'click {"button":"Menu"}': { error: "no such button" },
    });
    const result = await run(
      [
        [call("click", { args: { button: "Menu" } })],
        [call("click", { args: { button: "Open menu" } })],
        [call("expect_visible", { args: { text: "Pricing" } })],
        [DONE()],
      ],
      act
    );
    assert.equal(result.kept[0].keyword, "click");
    assert.deepEqual(result.kept[0].args, { button: "Open menu" });
    assert.equal(result.turns[0].ok, false);
  });

  test("keeps whether a step wrote data", async () => {
    const { act } = stubAct({ 'click {"button":"Send"}': { submits: true } });
    const result = await run(
      [
        [call("click", { args: { button: "Send" } })],
        [call("expect_visible", { args: { text: "Thanks" } })],
        [DONE()],
      ],
      act
    );
    assert.equal(result.kept[0].submits, true);
  });

  test("a step that leaves the site ends the case impossible", async () => {
    const { act } = stubAct({
      'click {"button":"Book a demo"}': {
        stop: "it left the site for https://calendly.com",
      },
    });
    const result = await run(
      [[call("click", { args: { button: "Book a demo" } })]],
      act
    );
    assert.equal(result.outcome, "impossible");
    assert.match(result.summary, /calendly/);
  });

  test("finish done without an assertion is refused", async () => {
    const { act } = stubAct();
    const result = await run(
      [
        [call("goto", { args: "/pricing" })],
        [DONE()],
        [call("expect_url", { args: { contains: "/pricing" } })],
        [DONE()],
      ],
      act
    );
    assert.equal(result.outcome, "done");
    assert.equal(result.turns[1].ok, false);
    assert.match(result.turns[1].result, /assert/);
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
    const result = await run(
      [
        [call("track", { args: {} })],
        [call("click", "{not json")],
        [call("goto", { nope: 1 })],
      ],
      act,
      3
    );
    assert.equal(ran.length, 0);
    assert.equal(result.turns.filter((turn) => !turn.ok).length, 3);
  });

  test("every tool call counts towards max_actions, invalid ones too", async () => {
    const { act } = stubAct();
    const result = await run(
      [
        [call("nope", {})],
        [call("nope", {})],
        [call("nope", {})],
        [call("nope", {})],
      ],
      act,
      3
    );
    assert.equal(result.outcome, "incomplete");
    assert.equal(result.turns.length, 3);
  });

  test("text without a tool call twice ends incomplete; empty replies are not kept", async () => {
    const { act } = stubAct();
    const client = stubClient(["", "Still thinking."]);
    const result = await authorCase("goal", {
      client,
      observe: async () => EVIDENCE,
      act,
      maxActions: 30,
    });
    assert.equal(result.outcome, "incomplete");
    assert.ok(
      !client.requests[1].messages.some(
        (message) =>
          message.role === "assistant" &&
          message.text === "" &&
          message.toolCalls.length === 0
      )
    );
  });

  test("only the last observations keep their screenshot", async () => {
    const { act } = stubAct();
    const client = stubClient([
      [call("goto", { args: "/a" })],
      [call("goto", { args: "/b" })],
      [call("goto", { args: "/c" })],
      [call("expect_url", { args: { contains: "/c" } })],
      [DONE()],
    ]);
    await authorCase("goal", {
      client,
      observe: async () => EVIDENCE,
      act,
      maxActions: 30,
    });
    const last = client.requests[client.requests.length - 1];
    const images = last.messages.flatMap((message) =>
      message.role === "user"
        ? message.parts.filter((part) => part.type === "image")
        : []
    );
    assert.equal(images.length, 2);
  });

  test("page content is fenced and marked as data, not instructions", async () => {
    const { act } = stubAct();
    const client = stubClient(["", ""]);
    await authorCase("goal", {
      client,
      observe: async () => EVIDENCE,
      act,
      maxActions: 30,
    });
    assert.match(client.requests[0].system, /never instructions/i);
    const first = client.requests[0].messages[0];
    assert.ok(first.role === "user");
    const text = first.parts.find((part) => part.type === "text");
    assert.ok(text !== undefined && text.type === "text");
    assert.match(text.text, /<page>[\s\S]*<\/page>/);
  });

  test("a provider error ends incomplete with the error", async () => {
    const { act } = stubAct();
    const result = await run([new Error("503 overloaded")], act);
    assert.equal(result.outcome, "incomplete");
    assert.match(result.summary, /503/);
  });
});
