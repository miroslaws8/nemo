import { z } from "zod";
import type {
  IAuthorDeps,
  IAuthorResult,
  IAuthorStep,
  IAuthorTurn,
  IEvidence,
  IModelMessage,
  IModelToolCall,
} from "../../types";
import { AUTHOR_STEP_KEYWORDS, authorTools, finishSchema } from "./tools";

// The test author's loop: the model sees the page, calls one of nemo's steps as a tool, the engine
// runs it (guards first) and shows the page again — until the model calls `finish`, the action
// limit is reached, or the model stops answering with tools. Steps that worked are kept, in order:
// they are the test.

const MAX_ANSWER_TOKENS = 2048;
const CALL_TIMEOUT_MS = 90_000;

const SYSTEM = [
  "You are a QA engineer writing one end-to-end test for nemo by walking it in a real browser.",
  "The user describes what to check. Reach it step by step with the tools: each tool is one nemo test step, run at once on the page; you then see the page again.",
  "Prefer goto to a route (e.g. /pricing) over clicking through menus, unless the menu or the click is what is checked.",
  "Name targets by what a user sees: { button: name }, { role: link, name }, { label }, { text }. Use css only when nothing else names it.",
  "A step that fails is not kept; try another way. Never type credentials: the test account is already signed in where needed.",
  "When the goal is reached, add the assertions that prove it (expect_visible, expect_url, expect …). Use ai_check only for what no plain assertion can check (layout, readability).",
  "Then call finish with outcome done and a one-line summary of what the test checks; if the goal cannot be reached, call finish with outcome impossible and why.",
].join("\n");

const NUDGE = "Use one of the tools; call finish when you are done.";

const toolInputSchema = z
  .object({ args: z.unknown() })
  .refine((input) => input.args !== undefined, "missing args");

const STEP_KEYWORDS: readonly string[] = AUTHOR_STEP_KEYWORDS;

function observation(evidence: IEvidence, intro: string): IModelMessage {
  return {
    role: "user",
    parts: [
      { type: "image", png: evidence.png },
      {
        type: "text",
        text: [
          intro,
          `Page: ${evidence.url}`,
          `ARIA snapshot:\n${evidence.aria}`,
        ].join("\n\n"),
      },
    ],
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function inputError(input: unknown): string | null {
  const parsed = toolInputSchema.safeParse(input);
  return parsed.success
    ? null
    : 'error: the input must be an object { "args": … } with the step\'s argument';
}

export async function authorCase(
  goal: string,
  deps: IAuthorDeps
): Promise<IAuthorResult> {
  const tools = authorTools();
  const messages: IModelMessage[] = [
    observation(await deps.observe(), `What to check: ${goal}`),
  ];
  const kept: IAuthorStep[] = [];
  const turns: IAuthorTurn[] = [];
  let actions = 0;
  let nudged = false;

  const end = (
    outcome: IAuthorResult["outcome"],
    summary: string
  ): IAuthorResult => ({ outcome, summary, kept, turns });

  for (;;) {
    let reply;
    try {
      reply = await deps.client.complete({
        system: SYSTEM,
        messages,
        tools,
        maxTokens: MAX_ANSWER_TOKENS,
        timeoutMs: CALL_TIMEOUT_MS,
      });
    } catch (error) {
      return end("incomplete", describeError(error));
    }
    messages.push({
      role: "assistant",
      text: reply.text,
      toolCalls: reply.toolCalls,
    });

    if (reply.toolCalls.length === 0) {
      if (nudged) {
        return end("incomplete", "the model stopped using the tools");
      }
      nudged = true;
      messages.push({ role: "user", parts: [{ type: "text", text: NUDGE }] });
      continue;
    }
    nudged = false;

    const results: { callId: string; text: string }[] = [];
    const answer = (call: IModelToolCall, ok: boolean, text: string): void => {
      results.push({ callId: call.id, text });
      turns.push({ tool: call.name, input: call.input, ok, result: text });
    };

    for (const call of reply.toolCalls) {
      if (call.name === "finish") {
        const finish = finishSchema.safeParse(call.input);
        if (finish.success) {
          answer(call, true, "finished");
          return end(finish.data.outcome, finish.data.summary);
        }
        answer(call, false, `error: ${z.prettifyError(finish.error)}`);
        continue;
      }
      if (!STEP_KEYWORDS.includes(call.name)) {
        answer(call, false, `error: there is no tool "${call.name}"`);
        continue;
      }
      const invalid = inputError(call.input);
      if (invalid !== null) {
        answer(call, false, invalid);
        continue;
      }
      const parsed = toolInputSchema.parse(call.input);
      const step = { keyword: call.name, args: parsed.args };
      actions += 1;
      const outcome = await deps.act(step);
      if (outcome.error === null) {
        kept.push({ ...step, submits: outcome.submits });
        answer(call, true, "ok");
      } else {
        answer(call, false, `error: ${outcome.error}`);
      }
      if (actions >= deps.maxActions) {
        return end(
          "incomplete",
          `reached ${deps.maxActions} actions without finishing`
        );
      }
    }

    messages.push({ role: "tool", results });
    messages.push(observation(await deps.observe(), "The page now:"));
  }
}
