import type { Page } from "@playwright/test";
import type { IEvidence, IRegion } from "../types";

// What the judge shows a model: the page from its top (capped, so a long page stays within what
// providers take — Anthropic refuses images over 8000 px a side), and its ARIA snapshot (trimmed).

const MAX_CAPTURE_HEIGHT_CSS = 3000;
const MAX_ARIA_CHARACTERS = 20_000;
const NETWORK_IDLE_CAP_MS = 5_000;
const ANIMATIONS_CAP_MS = 2_000;

export async function captureEvidence(page: Page): Promise<IEvidence> {
  const size = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    height: document.documentElement.scrollHeight,
  }));
  const png = await page.screenshot({
    fullPage: true,
    clip: {
      x: 0,
      y: 0,
      width: size.width,
      height: Math.min(size.height, MAX_CAPTURE_HEIGHT_CSS),
    },
  });
  const snapshot = await page.locator("body").ariaSnapshot();
  const aria =
    snapshot.length > MAX_ARIA_CHARACTERS
      ? `${snapshot.slice(0, MAX_ARIA_CHARACTERS)}\n…(trimmed)`
      : snapshot;
  return { png, aria, url: page.url() };
}

/** Lets the page come to rest before another look: network quiet, animations done (capped). */
export async function settlePage(page: Page): Promise<void> {
  await page
    .waitForLoadState("networkidle", { timeout: NETWORK_IDLE_CAP_MS })
    .catch(() => undefined);
  await page
    .waitForFunction(
      () =>
        document
          .getAnimations()
          .every((animation) => animation.playState !== "running"),
      undefined,
      { timeout: ANIMATIONS_CAP_MS }
    )
    .catch(() => undefined);
}

/**
 * The page with the model's regions drawn on it (a red box and its note each, like
 * hermes/qa-mark.js), as a PNG of the same capture; the marks are removed afterwards. Regions are
 * in screenshot pixels, so they are divided by the device's pixel ratio.
 */
export async function markRegions(
  page: Page,
  regions: IRegion[]
): Promise<Buffer> {
  await page.evaluate((boxes) => {
    const ratio = window.devicePixelRatio || 1;
    for (const box of boxes) {
      const mark = document.createElement("div");
      mark.setAttribute("data-nemo-mark", "");
      Object.assign(mark.style, {
        position: "absolute",
        left: `${box.x / ratio}px`,
        top: `${box.y / ratio}px`,
        width: `${box.width / ratio}px`,
        height: `${box.height / ratio}px`,
        outline: "3px solid #e11d48",
        background: "rgba(225, 29, 72, 0.12)",
        zIndex: "2147483647",
        pointerEvents: "none",
      });
      const label = document.createElement("span");
      label.textContent = box.note;
      Object.assign(label.style, {
        position: "absolute",
        left: "0",
        top: "-1.4em",
        font: "12px/1.2 sans-serif",
        color: "#fff",
        background: "#e11d48",
        padding: "1px 4px",
        whiteSpace: "nowrap",
      });
      mark.appendChild(label);
      document.documentElement.appendChild(mark);
    }
  }, regions);
  try {
    return (await captureEvidence(page)).png;
  } finally {
    await page.evaluate(() => {
      for (const mark of Array.from(
        document.querySelectorAll("[data-nemo-mark]")
      )) {
        mark.remove();
      }
    });
  }
}
