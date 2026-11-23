import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { AiUnavailableError } from "./client";
import { judge } from "./judge";
import type {
  IEvidence,
  IJudgeSettings,
  IModelClient,
  IModelReply,
} from "../types";

type IQueued = string | Error;

/** A model that answers from a queue: a JSON text, or an error to throw. */
function stubClient(
  model: string,
  queue: IQueued[]
): IModelClient & { calls: number } {
  const client = {
    role: model,
    model,
    calls: 0,
    async complete(): Promise<IModelReply> {
      client.calls += 1;
      const next = queue.shift();
      if (next === undefined) {
        throw new Error("no more answers queued");
      }
      if (next instanceof Error) {
        throw next;
      }
      return {
        text: next,
        usage: { inputTokens: 1, outputTokens: 1 },
        refused: false,
      };
    },
  };
  return client;
}

function answer(verdict: string, confidence: number, reason = "seen"): string {
  return JSON.stringify({ verdict, confidence, reason });
}

function stubEvidence(): {
  capture: () => Promise<IEvidence>;
  settle: () => Promise<void>;
  counts: { capture: number; settle: number };
} {
  const counts = { capture: 0, settle: 0 };
  return {
    counts,
    capture: async () => {
      counts.capture += 1;
      return { png: Buffer.from([1]), aria: "- heading", url: "https://x/" };
    },
    settle: async () => {
      counts.settle += 1;
    },
  };
}

const SETTINGS: IJudgeSettings = {
  model: "fast",
  escalateTo: null,
  minConfidence: 0.7,
  retries: 2,
  blocking: true,
};

const INPUT = {
  question: "Is the price readable?",
  testTitle: "pricing",
  stepsSoFar: ["goto /pricing"],
};

describe("judge", () => {
  test("confident pass the first time", async () => {
    const primary = stubClient("fast-1", [answer("pass", 0.9)]);
    const evidence = stubEvidence();
    const result = await judge(
      INPUT,
      evidence,
      { primary, escalation: null },
      SETTINGS
    );
    assert.equal(result.outcome, "pass");
    assert.equal(result.attempts.length, 1);
    assert.equal(evidence.counts.settle, 0);
    assert.equal(evidence.counts.capture, 1);
  });

  test("unsure, then a confident fail after settling", async () => {
    const primary = stubClient("fast-1", [
      answer("unsure", 0.4),
      answer("fail", 0.8, "price cut off"),
    ]);
    const evidence = stubEvidence();
    const result = await judge(
      INPUT,
      evidence,
      { primary, escalation: null },
      SETTINGS
    );
    assert.equal(result.outcome, "fail");
    assert.equal(result.final?.reason, "price cut off");
    assert.equal(result.attempts.length, 2);
    assert.equal(evidence.counts.settle, 1);
    assert.equal(evidence.counts.capture, 2);
  });

  test("low confidence everywhere; the escalation is confident", async () => {
    const primary = stubClient("fast-1", [
      answer("pass", 0.5),
      answer("pass", 0.6),
      answer("fail", 0.3),
    ]);
    const escalation = stubClient("strong-1", [answer("pass", 0.95)]);
    const result = await judge(
      INPUT,
      stubEvidence(),
      { primary, escalation },
      { ...SETTINGS, escalateTo: "strong" }
    );
    assert.equal(result.outcome, "pass");
    assert.equal(result.attempts.length, 4);
    assert.equal(result.attempts[3].model, "strong-1");
  });

  test("never confident and no escalation: unsure", async () => {
    const primary = stubClient("fast-1", [
      answer("pass", 0.5),
      answer("fail", 0.5),
      answer("pass", 0.6, "last"),
    ]);
    const result = await judge(
      INPUT,
      stubEvidence(),
      { primary, escalation: null },
      SETTINGS
    );
    assert.equal(result.outcome, "unsure");
    assert.equal(result.final?.reason, "last");
  });

  test("a malformed reply is asked once more within the attempt", async () => {
    const primary = stubClient("fast-1", [
      "I think it passes.",
      answer("pass", 0.9),
    ]);
    const result = await judge(
      INPUT,
      stubEvidence(),
      { primary, escalation: null },
      SETTINGS
    );
    assert.equal(result.outcome, "pass");
    assert.equal(result.attempts.length, 1);
    assert.equal(primary.calls, 2);
  });

  test("a provider error ends that attempt only", async () => {
    const primary = stubClient("fast-1", [
      new Error("500"),
      answer("pass", 0.9),
    ]);
    const result = await judge(
      INPUT,
      stubEvidence(),
      { primary, escalation: null },
      SETTINGS
    );
    assert.equal(result.outcome, "pass");
    assert.equal(result.attempts[0].error, "500");
    assert.equal(result.attempts[0].answer, null);
  });

  test("no key anywhere: not judged", async () => {
    const noKey = (): Error =>
      new AiUnavailableError("no_key", "QA_AI_KEY is not set");
    const primary = stubClient("fast-1", [noKey(), noKey(), noKey()]);
    const escalation = stubClient("strong-1", [noKey()]);
    const result = await judge(
      INPUT,
      stubEvidence(),
      { primary, escalation },
      SETTINGS
    );
    assert.equal(result.outcome, "not_judged");
  });

  test("a model that cannot be asked is not asked again", async () => {
    const noKey = (): Error =>
      new AiUnavailableError("no_key", "QA_AI_KEY is not set");
    const primary = stubClient("fast-1", [noKey(), noKey(), noKey()]);
    const escalation = stubClient("strong-1", [answer("pass", 0.9)]);
    const evidence = stubEvidence();
    const result = await judge(
      INPUT,
      evidence,
      { primary, escalation },
      SETTINGS
    );
    assert.equal(result.outcome, "pass");
    assert.equal(primary.calls, 1);
    assert.equal(result.attempts.length, 2);
    assert.equal(evidence.counts.capture, 2);
  });

  test("a spent budget stops the loop", async () => {
    const budget = (): Error =>
      new AiUnavailableError("budget", "the run's AI budget is spent");
    const primary = stubClient("fast-1", [budget(), budget(), budget()]);
    const escalation = stubClient("strong-1", [budget()]);
    const evidence = stubEvidence();
    const result = await judge(
      INPUT,
      evidence,
      { primary, escalation },
      SETTINGS
    );
    assert.equal(result.outcome, "not_judged");
    assert.equal(result.attempts.length, 1);
    assert.equal(evidence.counts.settle, 0);
  });

  test("the budget runs out mid-loop: unsure, never pass", async () => {
    const budget = (): Error =>
      new AiUnavailableError("budget", "the run's AI budget is spent");
    const primary = stubClient("fast-1", [
      answer("pass", 0.5),
      budget(),
      budget(),
    ]);
    const result = await judge(
      INPUT,
      stubEvidence(),
      { primary, escalation: null },
      SETTINGS
    );
    assert.equal(result.outcome, "unsure");
  });
});
