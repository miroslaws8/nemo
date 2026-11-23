import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MODEL_PROTOCOLS } from "./protocols";
import type { IAiModelSettings, IModelRequest } from "../types";

// A PNG's first bytes are enough: the protocols only base64 it.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const REQUEST: IModelRequest = {
  system: "You judge web pages.",
  messages: [
    {
      role: "user",
      parts: [
        { type: "image", png: PNG },
        { type: "text", text: "Is the menu open?" },
      ],
    },
  ],
  tools: [],
  maxTokens: 1024,
  timeoutMs: 60_000,
};

const CLICK_TOOL = {
  name: "click",
  description: "Click a target.",
  schema: { type: "object", properties: { button: { type: "string" } } },
};

// A tool round trip: the model asked to click, the engine answered, then shows the page again.
const TOOL_REQUEST: IModelRequest = {
  ...REQUEST,
  tools: [CLICK_TOOL],
  messages: [
    { role: "user", parts: [{ type: "text", text: "Open the menu." }] },
    {
      role: "assistant",
      text: "",
      toolCalls: [
        { id: "call_1", name: "click", input: { button: "Open menu" } },
      ],
    },
    { role: "tool", results: [{ callId: "call_1", text: "ok" }] },
    { role: "user", parts: [{ type: "image", png: PNG }] },
  ],
};

interface ISeenRequest {
  url: string;
  body: Record<string, unknown>;
}

function fakeFetch(
  status: number,
  reply: unknown
): { fetchImpl: typeof fetch; seen: ISeenRequest[] } {
  const seen: ISeenRequest[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const text = typeof init?.body === "string" ? init.body : "{}";
    const body: unknown = JSON.parse(text);
    seen.push({
      url,
      body: typeof body === "object" && body !== null ? { ...body } : {},
    });
    return new Response(JSON.stringify(reply), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetchImpl, seen };
}

function settings(overrides: Partial<IAiModelSettings>): IAiModelSettings {
  return {
    protocol: "openai",
    model: "m-1",
    baseUrl: null,
    keyVariable: "QA_AI_KEY",
    vision: true,
    usdPerMillion: { input: 1, output: 1 },
    ...overrides,
  };
}

const OPENAI_REPLY = {
  id: "c1",
  object: "chat.completion",
  created: 0,
  model: "m-1",
  choices: [
    {
      index: 0,
      finish_reason: "stop",
      message: { role: "assistant", content: '{"verdict":"pass"}' },
    },
  ],
  usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
};

const ANTHROPIC_REPLY = {
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: "m-2",
  content: [{ type: "text", text: '{"verdict":"fail"}' }],
  stop_reason: "end_turn",
  usage: { input_tokens: 200, output_tokens: 40 },
};

describe("openai protocol", () => {
  test("sends system, text and image; maps the reply", async () => {
    const { fetchImpl, seen } = fakeFetch(200, OPENAI_REPLY);
    const reply = await MODEL_PROTOCOLS.openai.complete(
      settings({}),
      "key",
      REQUEST,
      fetchImpl
    );
    assert.equal(seen.length, 1);
    const body = seen[0].body;
    assert.equal(body.model, "m-1");
    const text = JSON.stringify(body.messages);
    assert.match(text, /"role":"system"/);
    assert.match(text, /You judge web pages\./);
    assert.match(text, /Is the menu open\?/);
    assert.match(text, /data:image\/png;base64,iVBORw0KGgo=/);
    assert.equal(reply.text, '{"verdict":"pass"}');
    assert.deepEqual(reply.usage, { inputTokens: 120, outputTokens: 30 });
    assert.equal(reply.refused, false);
  });

  test("goes to base_url", async () => {
    const { fetchImpl, seen } = fakeFetch(200, OPENAI_REPLY);
    await MODEL_PROTOCOLS.openai.complete(
      settings({ baseUrl: "http://localhost:11434/v1" }),
      null,
      REQUEST,
      fetchImpl
    );
    assert.equal(seen[0].url, "http://localhost:11434/v1/chat/completions");
  });

  test("a provider error rejects", async () => {
    const { fetchImpl } = fakeFetch(500, { error: { message: "down" } });
    await assert.rejects(
      MODEL_PROTOCOLS.openai.complete(settings({}), "key", REQUEST, fetchImpl)
    );
  });
});

describe("tool calling", () => {
  test("openai sends tools and a tool round trip", async () => {
    const { fetchImpl, seen } = fakeFetch(200, OPENAI_REPLY);
    await MODEL_PROTOCOLS.openai.complete(
      settings({}),
      "key",
      TOOL_REQUEST,
      fetchImpl
    );
    const body = seen[0].body;
    const text = JSON.stringify(body);
    assert.match(text, /"type":"function","function":\{"name":"click"/);
    assert.match(text, /"arguments":"\{\\"button\\":\\"Open menu\\"\}"/);
    assert.match(text, /"role":"tool","tool_call_id":"call_1","content":"ok"/);
  });

  test("openai maps the reply's tool calls", async () => {
    const { fetchImpl } = fakeFetch(200, {
      ...OPENAI_REPLY,
      choices: [
        {
          index: 0,
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_9",
                type: "function",
                function: {
                  name: "click",
                  arguments: '{"button":"Open menu"}',
                },
              },
              {
                id: "call_10",
                type: "function",
                function: { name: "click", arguments: "{not json" },
              },
            ],
          },
        },
      ],
    });
    const reply = await MODEL_PROTOCOLS.openai.complete(
      settings({}),
      "key",
      TOOL_REQUEST,
      fetchImpl
    );
    assert.deepEqual(reply.toolCalls[0], {
      id: "call_9",
      name: "click",
      input: { button: "Open menu" },
    });
    assert.equal(reply.toolCalls[1].input, "{not json");
    assert.equal(reply.text, "");
  });

  test("anthropic sends tools and a tool round trip", async () => {
    const { fetchImpl, seen } = fakeFetch(200, ANTHROPIC_REPLY);
    await MODEL_PROTOCOLS.anthropic.complete(
      settings({ protocol: "anthropic" }),
      "key",
      TOOL_REQUEST,
      fetchImpl
    );
    const text = JSON.stringify(seen[0].body);
    assert.match(
      text,
      /"name":"click","description":"Click a target.","input_schema"/
    );
    assert.match(
      text,
      /"type":"tool_use","id":"call_1","name":"click","input":\{"button":"Open menu"\}/
    );
    assert.match(
      text,
      /"type":"tool_result","tool_use_id":"call_1","content":"ok"/
    );
  });

  test("anthropic maps the reply's tool calls", async () => {
    const { fetchImpl } = fakeFetch(200, {
      ...ANTHROPIC_REPLY,
      content: [
        { type: "text", text: "Opening it." },
        {
          type: "tool_use",
          id: "toolu_1",
          name: "click",
          input: { button: "Open menu" },
        },
      ],
      stop_reason: "tool_use",
    });
    const reply = await MODEL_PROTOCOLS.anthropic.complete(
      settings({ protocol: "anthropic" }),
      "key",
      TOOL_REQUEST,
      fetchImpl
    );
    assert.deepEqual(reply.toolCalls, [
      { id: "toolu_1", name: "click", input: { button: "Open menu" } },
    ]);
    assert.equal(reply.text, "Opening it.");
  });
});

describe("both protocols", () => {
  test("ignore the SDKs' own environment variables (no other host gets the key)", async () => {
    process.env.OPENAI_BASE_URL = "http://elsewhere.invalid/v1";
    process.env.ANTHROPIC_BASE_URL = "http://elsewhere.invalid";
    try {
      const openai = fakeFetch(200, OPENAI_REPLY);
      await MODEL_PROTOCOLS.openai.complete(
        settings({}),
        "key",
        REQUEST,
        openai.fetchImpl
      );
      assert.equal(
        openai.seen[0].url,
        "https://api.openai.com/v1/chat/completions"
      );
      const anthropic = fakeFetch(200, ANTHROPIC_REPLY);
      await MODEL_PROTOCOLS.anthropic.complete(
        settings({ protocol: "anthropic" }),
        "key",
        REQUEST,
        anthropic.fetchImpl
      );
      assert.equal(
        anthropic.seen[0].url,
        "https://api.anthropic.com/v1/messages"
      );
    } finally {
      delete process.env.OPENAI_BASE_URL;
      delete process.env.ANTHROPIC_BASE_URL;
    }
  });

  test("a call that hangs is given up at the request's timeout", async () => {
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new Error("aborted"))
        );
      });
    const started = Date.now();
    await assert.rejects(
      MODEL_PROTOCOLS.openai.complete(
        settings({}),
        "key",
        { ...REQUEST, timeoutMs: 100 },
        hanging
      )
    );
    assert.ok(Date.now() - started < 5_000);
  });
});

describe("anthropic protocol", () => {
  test("sends image then text with max_tokens; maps the reply", async () => {
    const { fetchImpl, seen } = fakeFetch(200, ANTHROPIC_REPLY);
    const reply = await MODEL_PROTOCOLS.anthropic.complete(
      settings({ protocol: "anthropic", model: "m-2" }),
      "key",
      REQUEST,
      fetchImpl
    );
    const body = seen[0].body;
    assert.equal(body.model, "m-2");
    assert.equal(body.max_tokens, 1024);
    assert.equal(body.system, "You judge web pages.");
    const content = JSON.stringify(body.messages);
    assert.ok(
      content.indexOf('"type":"image"') < content.indexOf('"type":"text"')
    );
    assert.match(content, /"media_type":"image\/png"/);
    assert.equal(body.temperature, undefined);
    assert.equal(reply.text, '{"verdict":"fail"}');
    assert.deepEqual(reply.usage, { inputTokens: 200, outputTokens: 40 });
    assert.equal(reply.refused, false);
  });

  test("a refusal is marked", async () => {
    const { fetchImpl } = fakeFetch(200, {
      ...ANTHROPIC_REPLY,
      content: [],
      stop_reason: "refusal",
    });
    const reply = await MODEL_PROTOCOLS.anthropic.complete(
      settings({ protocol: "anthropic" }),
      "key",
      REQUEST,
      fetchImpl
    );
    assert.equal(reply.refused, true);
    assert.equal(reply.text, "");
  });
});
