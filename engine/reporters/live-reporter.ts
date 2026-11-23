import fs from "node:fs";
import path from "node:path";
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestError,
  TestResult,
  TestStep,
} from "@playwright/test/reporter";
import { selectedEnvironmentName } from "../environment";
import { NOTICE_ATTACHMENT_PREFIX } from "../notices";
import { E2E_ROOT } from "../paths";
import { runPaths } from "../run-dir";
import { runId } from "../run-info";
import { selectedProfileName } from "../run-selection";
import type {
  ILiveEventPayload,
  ILiveTest,
  INoticeKind,
  IStepKind,
  IYamlLocation,
} from "../types";
import { NOTICE_KINDS } from "./live-events";

// Streams a run as it goes to <run dir>/events.ndjson (schema: live-events.ts) and keeps the latest
// step screenshot of every running test in <run dir>/shots. Active with E2E_RUN_DIR (the console)
// or E2E_LIVE=1 (CI, into reports/). A reporter must never break a run, so a failed write is
// dropped, not thrown.

const OUTPUT_LIMIT = 8 * 1024;
const STEP_SCREENSHOT_PREFIX = "step-";
const ANSI_SEQUENCE = /\u001b\[[0-9;]*[A-Za-z]/g;
// Session tokens show up in error messages and logs; the console must not spread them further.
const SECRETS = [
  /Bearer\s+[A-Za-z0-9._~+/=-]+/g,
  /idp_access_token=[^;\s"']+/g,
];
const YAML_FILE = /\.ya?ml$/;

function clean(text: string): string {
  const plain = SECRETS.reduce(
    (result, pattern) => result.replace(pattern, "[redacted]"),
    text.replace(ANSI_SEQUENCE, "")
  );
  return plain.length > OUTPUT_LIMIT
    ? `${plain.slice(0, OUTPUT_LIMIT)}… (cut)`
    : plain;
}

function errorText(error: TestError): string {
  return clean(error.message ?? error.value ?? "unknown error");
}

function noticeKind(attachmentName: string): INoticeKind | null {
  return (
    NOTICE_KINDS.find(
      (kind) => attachmentName === `${NOTICE_ATTACHMENT_PREFIX}${kind}`
    ) ?? null
  );
}

function yamlLocation(step: TestStep): IYamlLocation | null {
  const location = step.location;
  if (location === undefined || !YAML_FILE.test(location.file)) {
    return null;
  }
  return {
    file: path.relative(E2E_ROOT, location.file),
    line: location.line,
  };
}

function stepKind(step: TestStep): IStepKind {
  if (yamlLocation(step) !== null) {
    return "yaml";
  }
  return step.title.startsWith("setup:") ? "setup" : "other";
}

function describeTest(test: TestCase, rootDir: string): ILiveTest {
  return {
    testId: test.id,
    project: test.parent.project()?.name ?? "",
    spec: path.relative(rootDir, test.location.file).split(path.sep).join("/"),
    file:
      test.annotations.find((annotation) => annotation.type === "file")
        ?.description ?? null,
    suite: test.parent.title,
    title: test.title,
    // Without the "@", as the JSON report (the console's catalog) lists them.
    tags: test.tags.map((tag) => tag.replace(/^@/, "")),
  };
}

function attemptKey(test: TestCase, result: TestResult): string {
  return `${test.id}#${result.retry}`;
}

export default class LiveReporter implements Reporter {
  private readonly paths = runPaths();
  private file: number | null = null;
  private sequence = 0;
  private stepCount = 0;
  private readonly stepIds = new Map<TestStep, string>();
  // The innermost YAML step that failed, per attempt: where the test broke.
  private readonly failedAt = new Map<string, IYamlLocation>();

  printsToStdio(): boolean {
    return false;
  }

  onBegin(config: FullConfig, suite: Suite): void {
    if (this.paths.events === null) {
      return;
    }
    try {
      fs.mkdirSync(path.dirname(this.paths.events), { recursive: true });
      if (this.paths.shots !== null) {
        fs.mkdirSync(this.paths.shots, { recursive: true });
      }
      this.file = fs.openSync(this.paths.events, "a");
    } catch {
      this.file = null;
      return;
    }
    this.emit({
      type: "run.begin",
      runId: runId(),
      env: selectedEnvironmentName(),
      profile: selectedProfileName(),
      workers: config.workers,
      tests: suite.allTests().map((test) => describeTest(test, config.rootDir)),
    });
  }

  onTestBegin(test: TestCase, result: TestResult): void {
    this.emit({
      type: "test.begin",
      testId: test.id,
      retry: result.retry,
      lane: result.parallelIndex,
    });
  }

  onStepBegin(test: TestCase, result: TestResult, step: TestStep): void {
    if (step.category !== "test.step") {
      return;
    }
    this.stepCount += 1;
    const stepId = `s${this.stepCount}`;
    this.stepIds.set(step, stepId);
    this.emit({
      type: "step.begin",
      testId: test.id,
      retry: result.retry,
      stepId,
      parentId: this.parentStepId(step),
      title: step.title,
      kind: stepKind(step),
      yaml: yamlLocation(step),
    });
  }

  onStepEnd(test: TestCase, result: TestResult, step: TestStep): void {
    if (step.category === "test.attach") {
      this.saveScreenshots(test, result, step);
      this.sendNotices(test, result, step);
      return;
    }
    const stepId = this.stepIds.get(step);
    if (stepId === undefined) {
      return;
    }
    this.stepIds.delete(step);

    const location = yamlLocation(step);
    const key = attemptKey(test, result);
    // Inner steps end first, so the first failing YAML step recorded is the innermost one.
    if (
      step.error !== undefined &&
      location !== null &&
      !this.failedAt.has(key)
    ) {
      this.failedAt.set(key, location);
    }
    this.emit({
      type: "step.end",
      testId: test.id,
      retry: result.retry,
      stepId,
      ms: step.duration,
      error: step.error === undefined ? null : errorText(step.error),
    });
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const key = attemptKey(test, result);
    const failedAt = this.failedAt.get(key) ?? null;
    this.failedAt.delete(key);
    this.emit({
      type: "test.end",
      testId: test.id,
      retry: result.retry,
      status: result.status,
      outcome: test.outcome(),
      ms: result.duration,
      errors: result.errors.map((error, index) => ({
        message: errorText(error),
        yaml: index === 0 ? failedAt : null,
      })),
      annotations: result.annotations.map((annotation) => ({
        type: annotation.type,
        description:
          annotation.description === undefined
            ? null
            : clean(annotation.description),
      })),
      attachments: result.attachments.flatMap((attachment) =>
        attachment.path === undefined
          ? []
          : [{ name: attachment.name, path: this.relative(attachment.path) }]
      ),
    });
  }

  onStdOut(chunk: string | Buffer, test: void | TestCase): void {
    this.output("stdout", chunk, test);
  }

  onStdErr(chunk: string | Buffer, test: void | TestCase): void {
    this.output("stderr", chunk, test);
  }

  onError(error: TestError): void {
    this.emit({ type: "run.error", message: errorText(error) });
  }

  onEnd(result: FullResult): void {
    this.emit({ type: "run.end", status: result.status, ms: result.duration });
    if (this.file !== null) {
      try {
        fs.closeSync(this.file);
      } catch {
        // The run is over either way.
      }
      this.file = null;
    }
  }

  private parentStepId(step: TestStep): string | null {
    let parent = step.parent;
    while (parent !== undefined) {
      const id = this.stepIds.get(parent);
      if (id !== undefined) {
        return id;
      }
      parent = parent.parent;
    }
    return null;
  }

  // The engine attaches a screenshot after every YAML step (step-NN); only the latest one of an
  // attempt is kept, as shots/<test id>-<retry>.png.
  private saveScreenshots(
    test: TestCase,
    result: TestResult,
    step: TestStep
  ): void {
    if (this.file === null || this.paths.shots === null) {
      return;
    }
    const screenshot = step.attachments.find(
      (attachment) =>
        attachment.name.startsWith(STEP_SCREENSHOT_PREFIX) &&
        attachment.body !== undefined
    );
    if (screenshot?.body === undefined) {
      return;
    }
    const target = path.join(
      this.paths.shots,
      `${test.id}-${result.retry}.png`
    );
    try {
      fs.writeFileSync(target, screenshot.body);
    } catch {
      return;
    }
    this.emit({
      type: "step.shot",
      testId: test.id,
      retry: result.retry,
      stepId: this.parentStepId(step),
      path: this.relative(target),
    });
  }

  // The engine attaches a notice as "notice:<kind>" (engine/notices.ts).
  private sendNotices(
    test: TestCase,
    result: TestResult,
    step: TestStep
  ): void {
    for (const attachment of step.attachments) {
      const kind = noticeKind(attachment.name);
      if (kind === null) {
        continue;
      }
      this.emit({
        type: "test.notice",
        testId: test.id,
        retry: result.retry,
        kind,
        message: clean(attachment.body?.toString("utf8") ?? ""),
      });
    }
  }

  private output(
    stream: "stdout" | "stderr",
    chunk: string | Buffer,
    test: void | TestCase
  ): void {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    this.emit({
      type: "test.output",
      testId: typeof test === "object" ? test.id : null,
      stream,
      text: clean(text),
    });
  }

  // Paths are stored relative to the run folder, so a run folder can be moved or served as is.
  private relative(filePath: string): string {
    return this.paths.runDir === null
      ? filePath
      : path.relative(this.paths.runDir, filePath);
  }

  private emit(payload: ILiveEventPayload): void {
    if (this.file === null) {
      return;
    }
    const line = JSON.stringify({
      ...payload,
      seq: this.sequence,
      ts: new Date().toISOString(),
    });
    try {
      fs.writeSync(this.file, `${line}\n`);
      this.sequence += 1;
    } catch {
      // Dropped: a run never fails because the console could not follow it.
    }
  }
}
