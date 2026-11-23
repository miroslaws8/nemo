import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MODEL_PROTOCOLS } from "./protocols";
import type { IAiModelSettings, IModelRequest } from "../types";

// A PNG's first bytes are enough: the protocols only base64 it.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const REQUEST: IModelRequest = {
  system: "You judge web pages.",
  parts: [
    { type: "image", png: PNG },
    { type: "text", text: "Is the menu open?" },
  ],
  maxTokens: 1024,
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
