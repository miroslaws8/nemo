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
    assert.equal(evidence.top, 0);
    assert.equal(evidence.focus, null);
    assert.match(evidence.aria, /heading "Pricing"/);
    assert.match(evidence.aria, /button "Book a demo"/);
  });

  test("settling a quiet page returns", async () => {
    await settlePage(page);
  });

  test("marks regions on a copy and leaves the page as it was", async () => {
    const evidence = await captureEvidence(page);
    const marked = await markRegions(page, evidence, [
      { x: 0, y: 0, width: 200, height: 60, note: "cut off" },
    ]);
    const plain = evidence.png;
    assert.deepEqual(marked.subarray(0, 4), PNG_SIGNATURE);
    assert.notDeepEqual(marked, plain);
    assert.equal(await page.locator("[data-nemo-mark]").count(), 0);
  });

  test("a focus far down the page moves the capture there", async () => {
    const tall = await browser.newPage();
    await tall.setContent(
      '<body style="margin:0"><h1>Top</h1><div style="height:6000px"></div><p>Footer price $100</p></body>'
    );
    const evidence = await captureEvidence(tall, "Footer price");
    assert.deepEqual(evidence.focus, { text: "Footer price", found: true });
    assert.ok(evidence.top > 3000, `top is ${evidence.top}`);
    assert.match(evidence.aria, /Footer price/);
    await tall.close();
  });

  test("a focus whose words sit in separate elements is found", async () => {
    const tall = await browser.newPage();
    await tall.setContent(
      '<body style="margin:0"><div style="height:6000px"></div><div><span>Standard</span><span>$250</span></div></body>'
    );
    const evidence = await captureEvidence(tall, "Standard $250");
    assert.deepEqual(evidence.focus, { text: "Standard $250", found: true });
    assert.ok(evidence.top > 3000, `top is ${evidence.top}`);
    await tall.close();
  });

  test("a fixed header sits at the top of a focused capture, not over its middle", async () => {
    const tall = await browser.newPage({
      viewport: { width: 400, height: 800 },
    });
    await tall.setContent(`
      <body style="margin:0;background:#fff">
        <header style="position:fixed;top:0;left:0;right:0;height:60px;background:rgb(255,0,0)"></header>
        <div style="height:6000px"></div><p>Far text</p><div style="height:3000px"></div>
      </body>`);
    await tall.evaluate(() => window.scrollTo(0, 1200));
    const evidence = await captureEvidence(tall, "Far text");
    const decoder = await browser.newPage();
    const pixels = await decoder.evaluate(async (base64) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      if (context === null) {
        return [];
      }
      context.drawImage(image, 0, 0);
      const redRows: number[] = [];
      for (let y = 0; y < image.height; y += 20) {
        const [red, green] = context.getImageData(10, y, 1, 1).data;
        if (red > 200 && green < 50) {
          redRows.push(y);
        }
      }
      return redRows;
    }, evidence.png.toString("base64"));
    await decoder.close();
    assert.ok(pixels.length > 0, "the header is in the capture");
    assert.ok(
      pixels.every((y) => y < 60),
      `header rows: ${pixels.join(", ")}`
    );
    assert.equal(await tall.evaluate(() => window.scrollY), 1200);
    await tall.close();
  });

  test("the capture is in CSS pixels and at most 1600 tall, whatever the device", async () => {
    const context = await browser.newContext({
      viewport: { width: 400, height: 800 },
      deviceScaleFactor: 3,
    });
    const dense = await context.newPage();
    await dense.setContent(
      '<body style="margin:0"><div style="height:9000px"></div></body>'
    );
    const png = (await captureEvidence(dense)).png;
    assert.equal(png.readUInt32BE(16), 400);
    assert.equal(png.readUInt32BE(20), 1600);
    await context.close();
  });

  test("the URL goes without its query or fragment", async () => {
    const routed = await browser.newPage();
    await routed.route("https://example.test/**", (route) =>
      route.fulfill({ contentType: "text/html", body: "<h1>Hi</h1>" })
    );
    await routed.goto("https://example.test/pricing?token=abc#top");
    assert.equal(
      (await captureEvidence(routed)).url,
      "https://example.test/pricing"
    );
    await routed.close();
  });

  test("a focus that is not on the page keeps the top", async () => {
    const evidence = await captureEvidence(page, "Nowhere to be found");
    assert.deepEqual(evidence.focus, {
      text: "Nowhere to be found",
      found: false,
    });
    assert.equal(evidence.top, 0);
  });
});
