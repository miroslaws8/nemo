import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { chromium, type Browser, type Page } from "@playwright/test";
import { refuseByAvoid } from "./guards";
import { targetRefusal, watchWrites } from "./page-guards";

const APP = "https://app.test";
const AVOID = ["delete", "sign out", "logout", "pay"];
const IGNORE = [/trackevents/, /log_event/];

const PAGE = `
<form action="${APP}/save" method="post">
  <input aria-label="Message" name="message">
  <button><span>Send message</span></button>
</form>
<button type="button" id="js-save">Save draft</button>
<script>
  document.getElementById("js-save").addEventListener("click", () =>
    fetch("${APP}/api/drafts", { method: "POST", body: "{}" }).catch(() => {}));
</script>
<button><span>Delete account</span></button>
<input type="submit" value="Delete everything" form="none">
<button aria-describedby="x"><img alt="Delete course" src="data:,"></button>
<a href="/account/logout">Leave</a>
<p>Deleted items</p>
<button type="button" id="telemetry">Open menu</button>
<script>
  document.getElementById("telemetry").addEventListener("click", () => {
    fetch("https://telemetry.test/log_event", { method: "POST", body: "{}" }).catch(() => {});
    fetch("${APP}/__l5e/trackevents", { method: "POST", body: "{}" }).catch(() => {});
  });
</script>
<form action="https://forms.other.test/submit" method="post" id="external">
  <button>Join the list</button>
</form>`;

describe("page guards", () => {
  let browser: Browser;
  let page: Page;
  let posts: string[];

  before(async () => {
    browser = await chromium.launch();
  });

  after(async () => {
    await browser.close();
  });

  async function open(): Promise<void> {
    page = await browser.newPage();
    posts = [];
    await page.route(`${APP}/**`, async (route) => {
      const request = route.request();
      if (request.method() !== "GET") {
        posts.push(`${request.method()} ${new URL(request.url()).pathname}`);
      }
      await route.fulfill({ contentType: "text/html", body: PAGE });
    });
    await page.goto(`${APP}/`);
  }

  test("where writes are off, a form never reaches the server, and the step is told", async () => {
    await open();
    const watch = await watchWrites(page, false, [APP], IGNORE);
    watch.begin();
    await page.getByText("Send message").click();
    await page.waitForTimeout(300);
    assert.deepEqual(watch.end(), ["POST /save"]);
    assert.deepEqual(posts, []);
    await page.close();
  });

  test("a script's POST from a plain button counts as a write too", async () => {
    await open();
    const watch = await watchWrites(page, false, [APP], IGNORE);
    watch.begin();
    await page.locator("#js-save").click();
    await page.waitForTimeout(300);
    assert.deepEqual(watch.end(), ["POST /api/drafts"]);
    assert.deepEqual(posts, []);
    await page.close();
  });

  test("where writes are on, the form is sent and the write is reported", async () => {
    await open();
    const watch = await watchWrites(page, true, [APP], IGNORE);
    watch.begin();
    await page.getByText("Send message").click();
    await page.waitForTimeout(300);
    assert.deepEqual(watch.end(), ["POST /save"]);
    assert.deepEqual(posts, ["POST /save"]);
    await page.close();
  });

  test("telemetry is not a write: other sites' scripts and ignored paths", async () => {
    await open();
    const watch = await watchWrites(page, false, [APP], IGNORE);
    watch.begin();
    await page.locator("#telemetry").click();
    await page.waitForTimeout(300);
    assert.deepEqual(watch.end(), []);
    assert.deepEqual(posts, [], "still never sent where writes are off");
    await page.close();
  });

  test("a form sent to another site is a write", async () => {
    await open();
    await page.route("https://forms.other.test/**", (route) =>
      route.fulfill({ contentType: "text/html", body: "thanks" })
    );
    const watch = await watchWrites(page, false, [APP], IGNORE);
    watch.begin();
    await page.getByText("Join the list").click();
    await page.waitForTimeout(300);
    assert.deepEqual(watch.end(), ["POST /submit"]);
    await page.close();
  });

  test("avoid words are found in nested text, values and alt texts", async () => {
    await open();
    const refusal = (args: unknown): Promise<string | null> =>
      targetRefusal(page, "click", args, AVOID, APP, 2_000);
    assert.ok((await refusal({ text: "Delete account" })) !== null);
    assert.ok((await refusal({ css: "input[type=submit]" })) !== null);
    assert.ok((await refusal({ css: "button[aria-describedby]" })) !== null);
    assert.ok(
      (await refusal({ text: "Leave" })) !== null,
      "href /account/logout"
    );
    assert.equal(await refusal({ text: "Deleted items" }), null);
    await page.close();
  });

  test("a target that is not there yet is waited for, then checked", async () => {
    await open();
    await page.evaluate(() =>
      setTimeout(() => {
        const late = document.createElement("button");
        late.textContent = "Delete workspace";
        document.body.append(late);
      }, 800)
    );
    assert.ok(
      (await targetRefusal(
        page,
        "click",
        { button: "Delete workspace" },
        AVOID,
        APP,
        3_000
      )) !== null
    );
    await page.close();
  });

  test("a target that cannot be checked is refused, not let through", async () => {
    await open();
    assert.match(
      (await targetRefusal(
        page,
        "click",
        { button: "Nowhere" },
        AVOID,
        APP,
        300
      )) ?? "",
      /could not be checked/
    );
    await page.close();
  });

  test("press on a target is checked like a click", async () => {
    await open();
    assert.ok(
      (await targetRefusal(
        page,
        "press",
        { text: "Delete account", key: "Enter" },
        AVOID,
        APP,
        2_000
      )) !== null
    );
    await page.close();
  });

  test("a goto path with an avoid word is refused", async () => {
    await open();
    assert.ok(
      (await targetRefusal(
        page,
        "goto",
        "/account/delete",
        AVOID,
        APP,
        300
      )) !== null
    );
    assert.equal(
      await targetRefusal(page, "goto", "/pricing", AVOID, APP, 300),
      null
    );
    await page.close();
  });
});

describe("avoid words", () => {
  test("logout and signout in one word are caught", () => {
    assert.ok(refuseByAvoid("Logout", ["logout"]) !== null);
  });

  test("words with letters beyond ASCII match whole words", () => {
    assert.ok(refuseByAvoid("Usuń konto", ["usuń"]) !== null);
    assert.equal(refuseByAvoid("Usuńmy", ["usuń"]), null);
  });
});
