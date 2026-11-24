import { z } from "zod";
import type { IAuthorArgs } from "../../types";

// pnpm author's arguments, and the verdict on a draft's verification run: read from that run's own
// JSON report, and failed when there is none (never a pass by default).

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

const statsSchema = z.object({
  stats: z.object({
    expected: z.number(),
    unexpected: z.number(),
    flaky: z.number(),
    skipped: z.number(),
  }),
});

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

/**
 * Why a verification run does not count, or null when it passed: its report exists, its one test
 * passed (not flaky, not skipped), and each of the draft's `aiCheckSteps` ai_checks was judged pass.
 */
export function verificationVerdict(
  report: unknown,
  aiCheckSteps: number
): string | null {
  const parsed = statsSchema.safeParse(report);
  if (!parsed.success) {
    return "no report of the verification run";
  }
  const { expected, unexpected, flaky, skipped } = parsed.data.stats;
  if (expected < 1 || unexpected > 0 || flaky > 0 || skipped > 0) {
    return `the draft did not pass (passed ${expected}, failed ${unexpected}, flaky ${flaky}, skipped ${skipped})`;
  }
  const outcomes = aiCheckOutcomes(report, []);
  if (outcomes.length !== aiCheckSteps) {
    return `${aiCheckSteps} ai_check step(s), but ${outcomes.length} judged`;
  }
  const notPass = outcomes.filter((outcome) => outcome !== "pass");
  return notPass.length === 0
    ? null
    : `an ai_check was not judged pass (${notPass.join(", ")})`;
}
