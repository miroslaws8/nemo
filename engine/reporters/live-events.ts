import { z } from "zod";

// What a run reports while it goes, one JSON object per line of <run dir>/events.ndjson (written by
// live-reporter.ts, read by the console). `seq` grows by one per event, so a reader can resume.

const sequence = { seq: z.number().int().nonnegative(), ts: z.iso.datetime() };
const attempt = { testId: z.string().min(1), retry: z.number().int().min(0) };

export const yamlLocationSchema = z.object({
  file: z.string().min(1),
  line: z.number().int().positive(),
});

export const liveTestSchema = z.object({
  testId: z.string().min(1),
  project: z.string(),
  // The spec file relative to the config's rootDir, as a --test-list line names it.
  spec: z.string(),
  // The YAML test file, from the test's "file" annotation (null for the login setup).
  file: z.string().nullable(),
  suite: z.string(),
  title: z.string(),
  tags: z.array(z.string()),
});

export const STEP_KINDS = ["yaml", "setup", "other"] as const;

export const TEST_STATUSES = [
  "passed",
  "failed",
  "timedOut",
  "skipped",
  "interrupted",
] as const;

export const TEST_OUTCOMES = [
  "expected",
  "unexpected",
  "flaky",
  "skipped",
] as const;

// What the people watching a run should know beyond pass/fail (engine/notices.ts): the API's rate
// limit slowing the run down, or the QA account's session gone.
export const NOTICE_KINDS = ["rate-limit", "session-lost"] as const;

export const RUN_END_STATUSES = [
  "passed",
  "failed",
  "timedout",
  "interrupted",
] as const;

export const liveEventSchema = z.discriminatedUnion("type", [
  z.object({
    ...sequence,
    type: z.literal("run.begin"),
    runId: z.string().min(1),
    env: z.string(),
    profile: z.string(),
    workers: z.number().int().min(1),
    tests: z.array(liveTestSchema),
  }),
  z.object({
    ...sequence,
    ...attempt,
    type: z.literal("test.begin"),
    lane: z.number().int().min(0),
  }),
  z.object({
    ...sequence,
    ...attempt,
    type: z.literal("step.begin"),
    stepId: z.string().min(1),
    parentId: z.string().nullable(),
    title: z.string(),
    kind: z.enum(STEP_KINDS),
    yaml: yamlLocationSchema.nullable(),
  }),
  z.object({
    ...sequence,
    ...attempt,
    type: z.literal("step.end"),
    stepId: z.string().min(1),
    ms: z.number().min(0),
    error: z.string().nullable(),
    // How a step that did not fail ended, worth a look (an agent's command that exited 1).
    note: z.string().nullable().optional(),
  }),
  z.object({
    ...sequence,
    ...attempt,
    type: z.literal("step.shot"),
    stepId: z.string().nullable(),
    path: z.string().min(1),
  }),
  z.object({
    ...sequence,
    ...attempt,
    type: z.literal("test.notice"),
    kind: z.enum(NOTICE_KINDS),
    message: z.string(),
  }),
  z.object({
    ...sequence,
    type: z.literal("test.output"),
    testId: z.string().nullable(),
    stream: z.enum(["stdout", "stderr"]),
    text: z.string(),
  }),
  z.object({
    ...sequence,
    ...attempt,
    type: z.literal("test.end"),
    status: z.enum(TEST_STATUSES),
    outcome: z.enum(TEST_OUTCOMES),
    ms: z.number().min(0),
    errors: z.array(
      z.object({ message: z.string(), yaml: yamlLocationSchema.nullable() })
    ),
    annotations: z.array(
      z.object({ type: z.string(), description: z.string().nullable() })
    ),
    attachments: z.array(z.object({ name: z.string(), path: z.string() })),
  }),
  z.object({
    ...sequence,
    type: z.literal("run.error"),
    message: z.string(),
  }),
  z.object({
    ...sequence,
    type: z.literal("run.end"),
    status: z.enum(RUN_END_STATUSES),
    ms: z.number().min(0),
  }),
]);
