import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { AiUnavailableError, createModelClient, missingKeys } from "./client";
import { runSpend } from "./spend";
import type {
  IAiProtocolName,
  IAiSettings,
  IModelProtocol,
  IModelReply,
} from "../types";

const KEY = "QA_AI_UNIT_TEST_KEY";

function settings(
  overrides: { keyVariable?: string | null } = {}
): IAiSettings {
  return {
    models: {
      fast: {
        protocol: "openai",
        model: "m-1",
        baseUrl: null,
        keyVariable:
          overrides.keyVariable === undefined ? KEY : overrides.keyVariable,
        vision: true,
        usdPerMillion: { input: 0.5, output: 2 },
      },
    },
    judge: {
      model: "fast",
      escalateTo: null,
      minConfidence: 0.7,
      retries: 2,
      blocking: true,
    },
    budgetUsdPerRun: 2,
  };
}

function fakeProtocols(reply: IModelReply): {
  protocols: Record<IAiProtocolName, IModelProtocol>;
  keys: (string | null)[];
} {
  const keys: (string | null)[] = [];
  const protocol: IModelProtocol = {
    async complete(_settings, apiKey) {
      keys.push(apiKey);
      return reply;
    },
  };
  return { protocols: { openai: protocol, anthropic: protocol }, keys };
}

const REPLY: IModelReply = {
  text: "{}",
  usage: { inputTokens: 1_000_000, outputTokens: 0 },
  refused: false,
};

const REQUEST = { system: "s", parts: [], maxTokens: 100 };

function tempSpend(): ReturnType<typeof runSpend> {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "ai-client-"));
  return runSpend(path.join(folder, "spend.ndjson"));
}

describe("model client", () => {
  test("no key: refuses before calling the model", async () => {
    delete process.env[KEY];
    const { protocols, keys } = fakeProtocols(REPLY);
    const client = createModelClient(
      settings(),
      "fast",
      tempSpend(),
      protocols
    );
    await assert.rejects(
      client.complete(REQUEST),
      (error: unknown) =>
        error instanceof AiUnavailableError && error.reason === "no_key"
    );
    assert.equal(keys.length, 0);
  });

  test("budget reached: refuses before calling the model", async () => {
    process.env[KEY] = "secret";
    const spend = tempSpend();
    spend.add(2, "m-1");
    const { protocols, keys } = fakeProtocols(REPLY);
    const client = createModelClient(settings(), "fast", spend, protocols);
    await assert.rejects(
      client.complete(REQUEST),
      (error: unknown) =>
        error instanceof AiUnavailableError && error.reason === "budget"
    );
    assert.equal(keys.length, 0);
  });

  test("records what a call cost", async () => {
    process.env[KEY] = "secret";
    const spend = tempSpend();
    const { protocols, keys } = fakeProtocols(REPLY);
    const client = createModelClient(settings(), "fast", spend, protocols);
    await client.complete(REQUEST);
    assert.deepEqual(keys, ["secret"]);
    assert.equal(spend.total(), 0.5);
    assert.equal(client.model, "m-1");
    assert.equal(client.role, "fast");
  });

  test("a local model without a key is called with none", async () => {
    const { protocols, keys } = fakeProtocols(REPLY);
    const client = createModelClient(
      settings({ keyVariable: null }),
      "fast",
      tempSpend(),
      protocols
    );
    await client.complete(REQUEST);
    assert.deepEqual(keys, [null]);
  });

  test("missingKeys names the judge's unset key variables", () => {
    delete process.env[KEY];
    assert.deepEqual(missingKeys(settings()), [
      `ai.models.fast.key: ${KEY} is not set`,
    ]);
    process.env[KEY] = "secret";
    assert.deepEqual(missingKeys(settings()), []);
  });
});
