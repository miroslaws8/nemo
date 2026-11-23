import { expect } from "@playwright/test";
import { z } from "zod";
import { durationSchema, parseDuration } from "../schema";
import type { IUrlMatchKey } from "../types";
import { defineStep } from "./define-step";

export const gotoStep = defineStep({
  keyword: "goto",
  schema: z.string().min(1),
  describe: (url) => `goto ${url}`,
  run: async (url, { page, errorMonitor }) => {
    // 429s of the previous page no longer explain anything on this one.
    errorMonitor.clearRateLimitHits();
    await page.goto(url, { waitUntil: "domcontentloaded" });
  },
});

const DEFAULT_URL_TIMEOUT_MS = 15_000;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const URL_PATTERNS: Record<IUrlMatchKey, (value: string) => RegExp> = {
  contains: (value) => new RegExp(escapeRegExp(value)),
  starts_with: (value) => new RegExp(`^${escapeRegExp(value)}`),
  matches: (value) => new RegExp(value),
};

const URL_MATCH_KEYS: readonly IUrlMatchKey[] = [
  "contains",
  "starts_with",
  "matches",
];

const expectUrlSchema = z
  .strictObject({
    contains: z.string().min(1).optional(),
    starts_with: z.string().min(1).optional(),
    matches: z.string().min(1).optional(),
    timeout: durationSchema.optional(),
  })
  .refine(
    (args) =>
      URL_MATCH_KEYS.filter((key) => args[key] !== undefined).length === 1,
    `expect_url needs exactly one of: ${URL_MATCH_KEYS.join(", ")}`
  );

// Retries until the URL matches, so it also catches a redirect that happens a moment later
// (to the login page, to /403).
export const expectUrlStep = defineStep({
  keyword: "expect_url",
  schema: expectUrlSchema,
  observesOnly: true,
  describe: (args) => {
    const key = URL_MATCH_KEYS.find(
      (candidate) => args[candidate] !== undefined
    );
    return key === undefined
      ? "expect URL"
      : `expect URL ${key.replace("_", " ")} "${String(args[key])}"`;
  },
  run: async (args, { page }) => {
    const key = URL_MATCH_KEYS.find(
      (candidate) => args[candidate] !== undefined
    );
    const value = key === undefined ? undefined : args[key];
    if (key === undefined || value === undefined) {
      throw new Error("expect_url needs contains, starts_with or matches");
    }
    await expect(page).toHaveURL(URL_PATTERNS[key](value), {
      timeout: parseDuration(args.timeout, DEFAULT_URL_TIMEOUT_MS),
    });
  },
});
