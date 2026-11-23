import type {
  IEvidence,
  IJudgeAnswer,
  IJudgeAttempt,
  IJudgeSettings,
  IJudgement,
  IModelClient,
  IModelRequest,
} from "../types";
import { AiUnavailableError } from "./client";
import { judgeAnswerSchema, parseJsonAnswer } from "./json-answer";

// The AI judge of an ai_check step: it shows a model the page (screenshot and ARIA snapshot) with
// the question and asks for a verdict and a confidence. Unsure, it lets the page settle, looks
// again (ai.judge.retries), then asks the stronger model (ai.judge.escalate_to). Only a confident
// answer decides; the rest is "unsure" (or "not_judged" when no model could be asked at all).

const MAX_ANSWER_TOKENS = 1024;

const SYSTEM = [
  "You are a meticulous QA engineer judging one moment of an end-to-end test of a web app.",
  "You get a screenshot of the page, its accessibility (ARIA) snapshot, the test and its steps so far, and one question.",
  "Answer the question about what a user would actually see. Do not guess beyond the evidence.",
  'Reply with JSON only: {"verdict": "pass" | "fail" | "unsure", "confidence": <0..1>, "reason": "<one or two sentences>", "regions": [{"x", "y", "width", "height", "note"}]}.',
  '"pass": the answer to the question is clearly yes. "fail": clearly no. "unsure": the evidence does not settle it (say why).',
  "confidence is how sure you are of the verdict (0.9 = very sure). regions are optional boxes, in screenshot pixels, around what made you decide (most useful for a fail).",
].join("\n");

interface IJudgeInput {
  question: string;
  testTitle: string;
  stepsSoFar: string[];
}

interface IJudgeEvidence {
  capture: () => Promise<IEvidence>;
  settle: () => Promise<void>;
}

interface IJudgeClients {
  primary: IModelClient;
  escalation: IModelClient | null;
}

function requestFor(input: IJudgeInput, evidence: IEvidence): IModelRequest {
  const steps = input.stepsSoFar.map((step) => `- ${step}`).join("\n");
  return {
    system: SYSTEM,
    maxTokens: MAX_ANSWER_TOKENS,
    parts: [
      { type: "image", png: evidence.png },
      {
        type: "text",
        text: [
          `Test: ${input.testTitle}`,
          `Page: ${evidence.url}`,
          `Steps so far:\n${steps || "- (none)"}`,
          `ARIA snapshot:\n${evidence.aria}`,
          `Question: ${input.question}`,
        ].join("\n\n"),
      },
    ],
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One look by one model: a malformed reply is asked once more on the same evidence. */
async function attempt(
  client: IModelClient,
  request: IModelRequest
): Promise<{ attempt: IJudgeAttempt; unavailable: boolean }> {
  try {
    for (let ask = 0; ask < 2; ask += 1) {
      const reply = await client.complete(request);
      const answer = reply.refused
        ? null
        : parseJsonAnswer(reply.text, judgeAnswerSchema);
      if (answer !== null) {
        return {
          attempt: { model: client.model, answer, error: null },
          unavailable: false,
        };
      }
    }
    return {
      attempt: {
        model: client.model,
        answer: null,
        error: "no valid answer (twice)",
      },
      unavailable: false,
    };
  } catch (error) {
    return {
      attempt: {
        model: client.model,
        answer: null,
        error: describeError(error),
      },
      unavailable: error instanceof AiUnavailableError,
    };
  }
}

function isConfident(
  answer: IJudgeAnswer | null,
  settings: IJudgeSettings
): answer is IJudgeAnswer {
  return (
    answer !== null &&
    answer.verdict !== "unsure" &&
    answer.confidence >= settings.minConfidence
  );
}

export async function judge(
  input: IJudgeInput,
  evidence: IJudgeEvidence,
  clients: IJudgeClients,
  settings: IJudgeSettings
): Promise<IJudgement> {
  const plan = [
    ...Array.from({ length: 1 + settings.retries }, () => clients.primary),
    ...(clients.escalation === null ? [] : [clients.escalation]),
  ];
  const attempts: IJudgeAttempt[] = [];
  let lastAnswer: IJudgeAnswer | null = null;
  let everyAttemptUnavailable = true;

  for (const [index, client] of plan.entries()) {
    if (index > 0) {
      await evidence.settle();
    }
    const result = await attempt(
      client,
      requestFor(input, await evidence.capture())
    );
    attempts.push(result.attempt);
    everyAttemptUnavailable &&= result.unavailable;
    lastAnswer = result.attempt.answer ?? lastAnswer;
    if (isConfident(result.attempt.answer, settings)) {
      return {
        outcome: result.attempt.answer.verdict,
        final: result.attempt.answer,
        attempts,
      };
    }
  }

  return {
    outcome: everyAttemptUnavailable ? "not_judged" : "unsure",
    final: lastAnswer,
    attempts,
  };
}
