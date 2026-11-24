import type { Page } from "@playwright/test";
import type { IEvidence, IRegion } from "../types";

// What the judge shows a model: part of the page (capped, so a long page stays within what
// providers take — Anthropic refuses images over 8000 px a side), from its top or around a text the
// model asked to look at (look_at), and the ARIA snapshot of the whole page (trimmed).

// In CSS pixels, and the screenshot is taken in CSS pixels (not the device's): 1600 tall stays
// readable after a provider scales the image down; look_at reaches the rest.
const MAX_CAPTURE_HEIGHT_CSS = 1600;
// A focused capture starts this far above the text, so what leads to it is in view too.
const FOCUS_LEAD_CSS = 600;
const MAX_ARIA_CHARACTERS = 20_000;
const NETWORK_IDLE_CAP_MS = 5_000;
const ANIMATIONS_CAP_MS = 2_000;
const FOCUS_SCROLL_TIMEOUT_MS = 2_000;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The text as the ARIA snapshot shows it, then its words with any spacing between them: the
 * snapshot joins the text of neighbouring elements ("Standard $250"), the DOM may not have the
 * space (<span>Standard</span><span>$250</span>).
 */
function focusMatchers(text: string): (string | RegExp)[] {
  const words = text.trim().split(/\s+/).map(escapeRegExp);
  return [text, new RegExp(words.join("\\s*"), "i")];
}

/** Where on the page (CSS px from the top) the first visible element with the text is; null if none. */
async function focusTop(page: Page, text: string): Promise<number | null> {
  let target = null;
  for (const matcher of focusMatchers(text)) {
    const candidate = page
      .getByText(matcher, { exact: false })
      .filter({ visible: true })
      .first();
    if ((await candidate.count()) > 0) {
      target = candidate;
      break;
    }
  }
  if (target === null) {
    return null;
  }
  await target
    .scrollIntoViewIfNeeded({ timeout: FOCUS_SCROLL_TIMEOUT_MS })
    .catch(() => undefined);
  const box = await target.boundingBox();
  if (box === null) {
    return null;
  }
  return box.y + (await page.evaluate(() => window.scrollY));
}

function originAndPath(address: string): string {
  const url = new URL(address);
  return url.protocol.startsWith("http")
    ? `${url.origin}${url.pathname}`
    : url.protocol;
}

export async function captureEvidence(
  page: Page,
  focus: string | null = null
): Promise<IEvidence> {
  const size = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    height: document.documentElement.scrollHeight,
    scrollY: window.scrollY,
  }));
  const height = Math.min(size.height, MAX_CAPTURE_HEIGHT_CSS);
  const focusedAt = focus === null ? null : await focusTop(page, focus);
  const top =
    focusedAt === null
      ? 0
      : Math.max(
          0,
          Math.min(Math.round(focusedAt) - FOCUS_LEAD_CSS, size.height - height)
        );
  // Fixed and sticky elements (a header) are drawn where the window is scrolled: scrolled to the
  // capture's top, they sit at its top, as a user sees them there, not over its middle. The page
  // is scrolled back afterwards: an ai_check only looks.
  const scrollTo = (y: number): Promise<void> =>
    page.evaluate((target) => window.scrollTo(0, target), y);
  await scrollTo(top);
  let png: Buffer;
  try {
    png = await page.screenshot({
      fullPage: true,
      scale: "css",
      clip: { x: 0, y: top, width: size.width, height },
    });
  } finally {
    await scrollTo(size.scrollY);
  }
  const snapshot = await page.locator("body").ariaSnapshot();
  const aria =
    snapshot.length > MAX_ARIA_CHARACTERS
      ? `${snapshot.slice(0, MAX_ARIA_CHARACTERS)}\n…(trimmed)`
      : snapshot;
  return {
    png,
    aria,
    // Origin and path only: a query or fragment may carry tokens.
    url: originAndPath(page.url()),
    top,
    focus: focus === null ? null : { text: focus, found: focusedAt !== null },
  };
}

/** What is on the screen now (the window, CSS pixels) and the ARIA snapshot: the author's look. */
export async function captureViewport(page: Page): Promise<IEvidence> {
  const png = await page.screenshot({ scale: "css" });
  const snapshot = await page.locator("body").ariaSnapshot();
  const aria =
    snapshot.length > MAX_ARIA_CHARACTERS
      ? `${snapshot.slice(0, MAX_ARIA_CHARACTERS)}\n…(trimmed)`
      : snapshot;
  const top = await page.evaluate(() => Math.round(window.scrollY));
  return { png, aria, url: originAndPath(page.url()), top, focus: null };
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
 * hermes/qa-mark.js), as a PNG of the same capture as `evidence`; the marks are removed
 * afterwards. Regions are in screenshot pixels, which are CSS pixels (scale "css"): moved
 * down by where the capture starts.
 */
export async function markRegions(
  page: Page,
  evidence: IEvidence,
  regions: IRegion[]
): Promise<Buffer> {
  await page.evaluate(
    ({ boxes, top }) => {
      for (const box of boxes) {
        const mark = document.createElement("div");
        mark.setAttribute("data-nemo-mark", "");
        Object.assign(mark.style, {
          position: "absolute",
          left: `${box.x}px`,
          top: `${top + box.y}px`,
          width: `${box.width}px`,
          height: `${box.height}px`,
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
    },
    { boxes: regions, top: evidence.top }
  );
  try {
    return (await captureEvidence(page, evidence.focus?.text ?? null)).png;
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
