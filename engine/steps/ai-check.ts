import { z } from "zod";
import { captureEvidence, markRegions, settlePage } from "../ai/evidence";
import { judge } from "../ai/judge";
import type { IEvidence, IJudgement, IRunContext } from "../types";
import { defineStep } from "./define-step";

// A question about the page for an AI judge (engine/ai/judge.ts, docs/guide.md → AI): it looks at
// the screenshot and the ARIA snapshot and answers with a verdict and a confidence, looking again
// and asking a stronger model when unsure. A confident "fail" fails the step when it blocks; an
// answer it is still unsure of, or none at all (no key, budget spent), passes the step and marks
// the test for review — never a silent pass. With AI off, only the screenshot and the question
// are attached, for a person to judge.

const argsSchema = z.union([
  z.string().min(5),
  z.strictObject({
    question: z.string().min(5),
    blocking: z.boolean().optional(),
  }),
]);

const JUDGE_TIME_CAP_MS = 180_000;

// Said once per worker: the run goes on without AI.
let warnedNotJudged = false;

async function attachPng(
  context: IRunContext,
  name: string,
  png: Buffer
): Promise<void> {
  await context.testInfo.attach(name, { body: png, contentType: "image/png" });
}

function annotate(context: IRunContext, type: string, text: string): void {
  context.testInfo.annotations.push({ type, description: text });
}

function record(
  context: IRunContext,
  question: string,
  attachment: string,
  judgement: IJudgement
): void {
  annotate(
    context,
    "ai_check",
    JSON.stringify({
      question,
      outcome: judgement.outcome,
      verdict: judgement.final?.verdict ?? null,
      confidence: judgement.final?.confidence ?? null,
      reason: judgement.final?.reason ?? null,
      attempts: judgement.attempts.map((attempt) => ({
        model: attempt.model,
        lookedAt: attempt.lookedAt,
        verdict: attempt.answer?.verdict ?? null,
        confidence: attempt.answer?.confidence ?? null,
        error: attempt.error,
      })),
      attachment,
    })
  );
}

export const aiCheckStep = defineStep({
  keyword: "ai_check",
  schema: argsSchema,
  // Not replayed after a rate limit: it would be judged, and paid for, again.
  observesOnly: false,
  describe: (args) =>
    `ai_check: ${typeof args === "string" ? args : args.question}`,
  run: async (args, context) => {
    const question = typeof args === "string" ? args : args.question;
    context.aiCheckCount += 1;
    const attachment = `ai-check-${context.aiCheckCount}`;
    const ai = context.ai;

    if (ai === null) {
      await attachPng(
        context,
        attachment,
        (
          await captureEvidence(context.page)
        ).png
      );
      annotate(
        context,
        "ai_check",
        JSON.stringify({ question, outcome: "off", attachment })
      );
      return;
    }

    // The last look, kept for the report (TypeScript does not follow assignments in closures).
    const seen: { evidence: IEvidence | null } = { evidence: null };
    const judgement = await judge(
      {
        question,
        testTitle: context.testInfo.titlePath.slice(1).join(" › "),
        stepsSoFar: context.stepLog,
      },
      {
        capture: async (focus) => {
          const evidence = await captureEvidence(context.page, focus);
          seen.evidence = evidence;
          return evidence;
        },
        settle: () => settlePage(context.page),
      },
      { primary: ai.primary, escalation: ai.escalation },
      ai.settings.judge,
      // At most half of the test's timeout, three minutes at most: the test must still finish.
      Date.now() + Math.min(JUDGE_TIME_CAP_MS, context.testInfo.timeout / 2)
    );
    const shown = seen.evidence;
    if (shown !== null) {
      await attachPng(context, attachment, shown.png);
    }
    record(context, question, attachment, judgement);

    const reason = judgement.final?.reason ?? "no answer";
    const confidence = judgement.final?.confidence.toFixed(2) ?? "—";
    const blocking =
      typeof args === "string"
        ? ai.settings.judge.blocking
        : args.blocking ?? ai.settings.judge.blocking;
    const outcomes: Record<IJudgement["outcome"], () => Promise<void>> = {
      pass: async () => undefined,
      fail: async () => {
        const regions = judgement.final?.regions ?? [];
        if (regions.length > 0 && shown !== null) {
          await attachPng(
            context,
            `${attachment}-marked`,
            await markRegions(context.page, shown, regions)
          );
        }
        if (blocking) {
          throw new Error(`AI check failed (${confidence}): ${reason}`);
        }
        annotate(context, "ai finding", `${question} — ${reason}`);
      },
      unsure: async () => {
        annotate(context, "ai review", `AI was not sure: ${reason}`);
      },
      not_judged: async () => {
        const why =
          judgement.attempts.find((attempt) => attempt.error !== null)?.error ??
          "no model answered";
        annotate(context, "ai review", `AI did not judge: ${why}`);
        if (!warnedNotJudged) {
          warnedNotJudged = true;
          console.warn(`ai_check not judged: ${why}`);
        }
      },
    };
    await outcomes[judgement.outcome]();
  },
});
