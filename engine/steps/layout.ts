import { expect, type Page } from "@playwright/test";
import { z } from "zod";
import type { IOverflow } from "../types";
import { defineStep } from "./define-step";

// Wider than the window by more than this is a layout bug; less is sub-pixel rounding.
const TOLERANCE_PX = 1;
const SETTLE_TIMEOUT_MS = 5_000;

/** How far the page reaches past the window's right edge, and the element that reaches furthest. */
async function measureOverflow(page: Page): Promise<IOverflow> {
  return page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    let widest = viewportWidth;
    let culprit: string | null = null;
    for (const element of Array.from(document.body.querySelectorAll("*"))) {
      const right = element.getBoundingClientRect().right;
      if (right > widest) {
        widest = right;
        const id = element.id === "" ? "" : `#${element.id}`;
        const text = (element.textContent ?? "").trim().slice(0, 40);
        culprit = `<${element.tagName.toLowerCase()}${id}> "${text}" (right edge at ${Math.round(
          right
        )}px)`;
      }
    }
    return {
      excess: document.documentElement.scrollWidth - viewportWidth,
      culprit,
    };
  });
}

// The phone check: nothing on the page scrolls sideways. Waits a little for the layout to settle.
export const expectFitsWidthStep = defineStep({
  keyword: "expect_fits_width",
  schema: z.literal(true),
  observesOnly: true,
  describe: () =>
    "expect the page to fit the window's width (no sideways scroll)",
  run: async (_enabled, { page }) => {
    let measured: IOverflow = { excess: 0, culprit: null };
    try {
      await expect
        .poll(
          async () => {
            measured = await measureOverflow(page);
            return measured.excess;
          },
          { timeout: SETTLE_TIMEOUT_MS }
        )
        .toBeLessThanOrEqual(TOLERANCE_PX);
    } catch (error) {
      throw new Error(
        `The page is ${measured.excess}px wider than the window (${
          page.viewportSize()?.width ?? "unknown"
        }px), so it scrolls sideways. Furthest right: ${
          measured.culprit ?? "unknown"
        }`,
        { cause: error }
      );
    }
  },
});
