import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { chromium, type Browser, type Page } from "@playwright/test";
import { captureEvidence, markRegions, settlePage } from "./evidence";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const CONTENT = `
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <body style="margin:0">
    <h1>Pricing</h1>
    <button>Book a demo</button>
  </body>`;

describe("evidence", () => {
  let browser: Browser;
  let page: Page;

  before(async () => {
    browser = await chromium.launch();
    page = await browser.newPage();
    await page.setContent(CONTENT);
  });

  after(async () => {
    await browser.close();
  });

  test("captures a PNG and the ARIA snapshot", async () => {
    const evidence = await captureEvidence(page);
    assert.deepEqual(evidence.png.subarray(0, 4), PNG_SIGNATURE);
    assert.match(evidence.aria, /heading "Pricing"/);
    assert.match(evidence.aria, /button "Book a demo"/);
  });

  test("settling a quiet page returns", async () => {
    await settlePage(page);
  });

  test("marks regions on a copy and leaves the page as it was", async () => {
    const plain = (await captureEvidence(page)).png;
    const marked = await markRegions(page, [
      { x: 0, y: 0, width: 200, height: 60, note: "cut off" },
    ]);
    assert.deepEqual(marked.subarray(0, 4), PNG_SIGNATURE);
    assert.notDeepEqual(marked, plain);
    assert.equal(await page.locator("[data-nemo-mark]").count(), 0);
  });
});
