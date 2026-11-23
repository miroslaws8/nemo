import { expect, type Page } from "@playwright/test";
import { z } from "zod";
import { describeTarget, locate } from "../locate";
import type { IErrorMonitor } from "../types";
import {
  hasSingleLocator,
  SINGLE_LOCATOR_MESSAGE,
  TARGET_SHAPE,
  targetSchema,
} from "../schema";
import { defineStep } from "./define-step";

const ASSERTION_KEYS = [
  "visible",
  "checked",
  "enabled",
  "contains",
  "matches",
  "count",
] as const;

const regexSource = z.string().refine((source) => {
  try {
    new RegExp(source);
    return true;
  } catch {
    return false;
  }
}, "not a valid regular expression");

const expectSchema = z
  .strictObject({
    ...TARGET_SHAPE,
    visible: z.boolean().optional(),
    checked: z.boolean().optional(),
    enabled: z.boolean().optional(),
    contains: z.string().optional(),
    // A regular expression the element's text must contain, e.g. "\\d+ of \\d+".
    matches: regexSource.optional(),
    count: z.number().int().min(0).optional(),
  })
  .refine(hasSingleLocator, SINGLE_LOCATOR_MESSAGE)
  .refine(
    (args) => ASSERTION_KEYS.some((key) => args[key] !== undefined),
    `expect needs at least one of: ${ASSERTION_KEYS.join(", ")}`
  );

export const expectStep = defineStep({
  keyword: "expect",
  schema: expectSchema,
  observesOnly: true,
  describe: (args) => {
    const checks = ASSERTION_KEYS.filter((key) => args[key] !== undefined)
      .map((key) => `${key}=${String(args[key])}`)
      .join(" ");
    return `expect ${describeTarget(args)} ${checks}`;
  },
  run: async (args, { page }) => {
    const locator = locate(page, args);

    if (args.visible !== undefined) {
      await expect(locator).toBeVisible({ visible: args.visible });
    }
    if (args.checked !== undefined) {
      await expect(locator).toBeChecked({ checked: args.checked });
    }
    if (args.enabled !== undefined) {
      await expect(locator).toBeEnabled({ enabled: args.enabled });
    }
    if (args.contains !== undefined) {
      await expect(locator).toContainText(args.contains);
    }
    if (args.matches !== undefined) {
      await expect(locator).toContainText(new RegExp(args.matches));
    }
    if (args.count !== undefined) {
      await expect(locator).toHaveCount(args.count);
    }
  },
});

export const expectVisibleStep = defineStep({
  keyword: "expect_visible",
  schema: targetSchema,
  observesOnly: true,
  describe: (target) => `expect ${describeTarget(target)} visible`,
  run: async (target, { page }) => {
    await expect(locate(page, target)).toBeVisible();
  },
});

export const expectHiddenStep = defineStep({
  keyword: "expect_hidden",
  schema: targetSchema,
  observesOnly: true,
  describe: (target) => `expect ${describeTarget(target)} hidden`,
  run: async (target, { page }) => {
    await expect(locate(page, target)).toBeHidden();
  },
});

// Copy the app actually renders on failure (translations/en.json). Bare status codes are not
// checked: generated course text can legitimately contain numbers like "500".
const ERROR_PHRASES = [
  "something went wrong",
  "page not found",
  "chat not found",
  "workspace not found",
  "could not be loaded",
];

const ERROR_PAGE_PATH = /^\/(403|404)\/?$/;

/**
 * Fails on what a user would see as an error: the 403/404 page, an error message on the page, or
 * anything the error monitor recorded since the test started (API 5xx/401/403, a login
 * redirect, error toasts, destructive alerts).
 */
export async function assertNoErrors(
  page: Page,
  errorMonitor: IErrorMonitor
): Promise<void> {
  const problems: string[] = [];

  if (!page.isClosed()) {
    const pathname = new URL(page.url()).pathname;
    if (ERROR_PAGE_PATH.test(pathname)) {
      problems.push(`redirected to the ${pathname} error page`);
    }
    const bodyText = (await page.locator("body").innerText()).toLowerCase();
    const phrase = ERROR_PHRASES.find((candidate) =>
      bodyText.includes(candidate)
    );
    if (phrase !== undefined) {
      problems.push(`the page shows "${phrase}"`);
    }
  }
  problems.push(...errorMonitor.errors());

  if (problems.length > 0) {
    throw new Error(`Errors during the test: ${problems.join("; ")}`);
  }
}

export const expectNoErrorsStep = defineStep({
  keyword: "expect_no_errors",
  schema: z.literal(true),
  observesOnly: true,
  describe: () =>
    "expect no error page, error message, error toast, API error or login redirect",
  run: async (_enabled, { page, errorMonitor }) => {
    await assertNoErrors(page, errorMonitor);
  },
});
