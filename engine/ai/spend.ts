import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { E2E_ROOT } from "../paths";
import { runPaths } from "../run-dir";
import { runId } from "../run-info";
import type { IRunSpend } from "../types";

// What a run's AI calls cost, one line per call, in a file every worker of the run appends to:
// the budget (ai.budget_usd_per_run) counts all of them. Read again for every check, so a worker
// sees what the others spent.

const lineSchema = z.object({ usd: z.number().min(0), model: z.string() });

/** The run's spend file: in the run's folder, else reports/ai-spend/<run id>.ndjson. */
export function runSpendFile(): string {
  const folder = runPaths().runDir ?? path.join(E2E_ROOT, "reports");
  return path.join(folder, "ai-spend", `${runId()}.ndjson`);
}

function readLine(line: string): number {
  try {
    const parsed = lineSchema.safeParse(JSON.parse(line));
    return parsed.success ? parsed.data.usd : 0;
  } catch {
    // A line another worker is still writing.
    return 0;
  }
}

export function runSpend(file: string = runSpendFile()): IRunSpend {
  return {
    total(): number {
      let text: string;
      try {
        text = fs.readFileSync(file, "utf8");
      } catch {
        return 0;
      }
      const sum = text
        .split("\n")
        .filter((line) => line.trim() !== "")
        .reduce((total, line) => total + readLine(line), 0);
      // Floating-point noise must not decide a budget check.
      return Math.round(sum * 1e6) / 1e6;
    },
    add(usd: number, model: string): void {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, `${JSON.stringify({ usd, model })}\n`);
    },
  };
}
