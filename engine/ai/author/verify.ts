import { z } from "zod";
import type { IAuthorArgs } from "../../types";

// pnpm author's arguments, and whether a verification's ai_checks were all judged pass.

const OPTIONS = new Set(["--env", "--verify", "--save"]);
const VALUED = new Set(["--env", "--verify"]);
const MAX_VERIFY = 5;

export function parseAuthorArgs(argv: string[]): IAuthorArgs {
  const values = new Map<string, string>();
  const words: string[] = [];
  let save = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) {
      words.push(argument);
      continue;
    }
    const [name, inline] = argument.split(/=(.*)/s, 2);
    if (!OPTIONS.has(name)) {
      throw new Error(
        `unknown option ${name} (options: ${[...OPTIONS].join(", ")})`
      );
    }
    if (name === "--save") {
      save = true;
    } else if (inline !== undefined) {
      values.set(name, inline);
    } else if (VALUED.has(name) && index + 1 < argv.length) {
      values.set(name, argv[index + 1]);
      index += 1;
    } else {
      throw new Error(`${name} needs a value`);
    }
  }
  const verify = Number(values.get("--verify") ?? "1");
  if (!Number.isInteger(verify) || verify < 1 || verify > MAX_VERIFY) {
    throw new Error(`--verify takes 1 to ${MAX_VERIFY}`);
  }
  return {
    environment: values.get("--env")?.toLowerCase() ?? null,
    goal: words.join(" ").trim(),
    verify,
    save,
  };
}

const outcomeSchema = z.object({ outcome: z.string() });

function aiCheckOutcomes(node: unknown, into: string[]): string[] {
  if (Array.isArray(node)) {
    node.forEach((child) => aiCheckOutcomes(child, into));
    return into;
  }
  if (typeof node !== "object" || node === null) {
    return into;
  }
  if (
    "type" in node &&
    node.type === "ai_check" &&
    "description" in node &&
    typeof node.description === "string"
  ) {
    try {
      const parsed = outcomeSchema.safeParse(JSON.parse(node.description));
      into.push(parsed.success ? parsed.data.outcome : "unreadable");
    } catch {
      into.push("unreadable");
    }
    return into;
  }
  Object.values(node).forEach((child) => aiCheckOutcomes(child, into));
  return into;
}

function judged(outcomes: string[], expected: number): string | null {
  if (outcomes.length !== expected) {
    return `${expected} ai_check step(s), but ${outcomes.length} judged`;
  }
  const notPass = outcomes.filter((outcome) => outcome !== "pass");
  return notPass.length === 0
    ? null
    : `an ai_check was not judged pass (${notPass.join(", ")})`;
}

/** The same for the annotations a verification run added to its test (in-process). */
export function aiChecksVerdict(
  annotations: { type: string; description?: string }[],
  expected: number
): string | null {
  return judged(aiCheckOutcomes(annotations, []), expected);
}
