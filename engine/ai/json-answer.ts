import { z } from "zod";

// Models wrap JSON in prose or a ```json fence, whatever the prompt says. The first JSON object
// in the reply is taken and checked against the expected shape; anything else is no answer.

const regionSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  note: z.string(),
});

/** What the judge asks a model for (engine/ai/judge.ts). */
export const judgeAnswerSchema = z.object({
  verdict: z.enum(["pass", "fail", "unsure"]),
  // 0..1: a model that answers in percent gave no answer.
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
  regions: z.array(regionSchema).default([]),
});

const FENCE = /```(?:json)?\s*([\s\S]*?)```/i;

/** The first balanced {…} in a text (braces inside strings do not count), or null. */
function firstObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) {
    return null;
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }
  return null;
}

/** The reply's JSON answer, checked against `schema`; null when there is none that fits. */
export function parseJsonAnswer<TAnswer>(
  text: string,
  schema: z.ZodType<TAnswer>
): TAnswer | null {
  const fenced = FENCE.exec(text)?.[1];
  const candidate = firstObject(fenced ?? text);
  if (candidate === null) {
    return null;
  }
  try {
    const parsed = schema.safeParse(JSON.parse(candidate));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
