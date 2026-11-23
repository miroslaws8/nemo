import { randomBytes } from "node:crypto";
import { loadE2eConfig } from "./config";
import type { IVariables } from "./types";

const TITLE_MAX_LENGTH = 150;

/**
 * Run ids that `pnpm sweep --run` accepts: local ones (c<date>-<time>-<random>), CI build
 * numbers, and the minute stamps (<date>-<hhmm>) of runs made before the random part existed.
 */
export const RUN_ID_PATTERN = /^(c\d{8}-\d{6}-[0-9a-f]{4}|\d+|\d{8}-\d{4})$/;

/**
 * A local run id: the start time (UTC, to the second) and a random part, so runs that two people
 * start in the same second still differ — a sweep by run id must hit one run only.
 */
export function newRunId(date: Date = new Date()): string {
  const iso = date.toISOString();
  const day = iso.slice(0, 10).replaceAll("-", "");
  const time = iso.slice(11, 19).replaceAll(":", "");
  return `c${day}-${time}-${randomBytes(2).toString("hex")}`;
}

/**
 * One id per run, shared by all workers: playwright.config.ts sets E2E_RUN_ID before workers
 * start (the CI build number, or a new local id; the console sets its own).
 */
export function ensureRunId(): void {
  process.env.E2E_RUN_ID ??= process.env.BITBUCKET_BUILD_NUMBER ?? newRunId();
  process.env.E2E_RUN_STARTED_AT ??= new Date().toISOString();
}

export function runId(): string {
  ensureRunId();
  return process.env.E2E_RUN_ID ?? newRunId();
}

/** Exposed to YAML as ${run.id} and ${run.timestamp}. */
export function runVariables(): IVariables {
  return {
    id: runId(),
    timestamp: process.env.E2E_RUN_STARTED_AT ?? new Date().toISOString(),
  };
}

/** The title for data a test creates: the safety prefix, the run id and the test's own title. */
export function dataTitle(testTitle: string): string {
  const prefix = loadE2eConfig().safety.data_prefix;
  return `${prefix}${runId()} ${testTitle}`.slice(0, TITLE_MAX_LENGTH);
}

/** Exposed to YAML as ${test.title} and ${test.data_title}. */
export function testVariables(testTitle: string): IVariables {
  return { title: testTitle, data_title: dataTitle(testTitle) };
}
