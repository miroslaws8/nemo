import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

// What agent checks spent, one line per finished check, in the console's own state folder
// (<state dir>/agent-spend.ndjson: no runner writes there). Run folders go after a while; this
// stays, so a day's spend counts every check of the day.

const lineSchema = z.object({
  day: z.string(),
  runId: z.string(),
  usd: z.number().min(0),
});

/** The UTC day of a moment, as YYYY-MM-DD. */
function dayOf(moment: Date): string {
  return moment.toISOString().slice(0, 10);
}

export class SpendLedger {
  private readonly file: string;

  constructor(stateDir: string) {
    this.file = path.join(stateDir, "agent-spend.ndjson");
  }

  add(runId: string, usd: number, at: Date = new Date()): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.appendFileSync(
      this.file,
      `${JSON.stringify({ day: dayOf(at), runId, usd })}\n`
    );
  }

  /** Dollars spent on `at`'s UTC day (a check counted once, whatever its lines). */
  spentOn(at: Date = new Date()): number {
    let text: string;
    try {
      text = fs.readFileSync(this.file, "utf8");
    } catch {
      return 0;
    }
    const day = dayOf(at);
    const byRun = new Map<string, number>();
    for (const line of text.split("\n")) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      const entry = lineSchema.safeParse(parsed);
      if (entry.success && entry.data.day === day) {
        byRun.set(entry.data.runId, entry.data.usd);
      }
    }
    return [...byRun.values()].reduce((total, usd) => total + usd, 0);
  }
}
