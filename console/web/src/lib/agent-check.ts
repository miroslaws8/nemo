import type {
  IAgentUsage,
  IRunRecord,
  IRunState,
  IRunStatus,
  ITestState,
} from "@shared/types";
import { formatTokens, formatUsd } from "./format";

// What an agent check's page reads from its one test (console/server/agents/agent-run.mts): the
// agent's report, its verdict line, and what the check spent.

// The note agent-run.mts gives the test: the agent's whole answer.
export const REPORT_NOTE = "Agent report";
// Its words stay on its own line (the next line is the report).
const RESULT_LINE = /^[ \t]*RESULT:[ \t]*(PASS|FAIL)\b[ \t:,.—–-]*(.*)$/m;

// What a finished check says when neither its errors nor its report do.
const ENDINGS: Partial<Record<IRunStatus, string>> = {
  passed: "The skill's checks passed.",
  interrupted: "Stopped before the agent reported.",
  timedout: "It ran past its time and was stopped.",
  killed: "Force-stopped: the agent did not report.",
  crashed: "It ended before the agent reported: the log says why.",
};

/** The check's one test (agent-run.mts reports a single one). */
export function agentTest(state: IRunState): ITestState | undefined {
  const testId = state.order[0];
  return testId === undefined ? undefined : state.tests[testId];
}

/** The agent's answer, as it gave it; null before it has one. */
export function agentReport(test: ITestState): string | null {
  return (
    test.annotations.find((note) => note.type === REPORT_NOTE)?.description ??
    null
  );
}

/** The report without its RESULT line (shown as the verdict). */
export function reportBody(report: string): string {
  return report.replace(RESULT_LINE, "").trim();
}

// The words after RESULT: PASS / FAIL on its line; null without any.
function ownWords(text: string): string | null {
  const words = RESULT_LINE.exec(text)?.[2]?.trim() ?? "";
  return words === "" ? null : words;
}

/** One line on how a finished check ended: its error, the verdict's own words, or the ending. */
export function verdictLine(
  run: IRunRecord,
  test: ITestState | undefined,
  report: string | null
): string | null {
  const error = test?.errors[0]?.message;
  if (error !== undefined) {
    return (
      ownWords(error) ??
      (RESULT_LINE.test(error)
        ? "The skill found a problem: its report says what."
        : error)
    );
  }
  return (
    (report === null ? null : ownWords(report)) ?? ENDINGS[run.status] ?? null
  );
}

/** What the check spent, in words: the tokens by kind (none written to the cache: not said), then the dollars. */
export function spendDetail(usage: IAgentUsage): string {
  const fresh =
    usage.inputTokens - usage.cacheReadTokens - usage.cacheWriteTokens;
  const kinds = [
    `${formatTokens(usage.cacheReadTokens)} read from the cache`,
    ...(usage.cacheWriteTokens > 0
      ? [`${formatTokens(usage.cacheWriteTokens)} written to it`]
      : []),
    `${formatTokens(Math.max(0, fresh))} new`,
  ];
  return `${formatTokens(usage.inputTokens)} input tokens (${kinds.join(
    ", "
  )}) and ${formatTokens(usage.outputTokens)} output, about ${formatUsd(
    usage.estimatedUsd
  )} at list prices`;
}
