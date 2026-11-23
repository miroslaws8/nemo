import type { Frame, Page, Response } from "@playwright/test";
import { loadE2eConfig } from "./config";
import { rateLimitPauseMs, TOO_MANY_REQUESTS } from "./rate-limit";
import type { IErrorMonitor, INotify, IRateLimitHit } from "./types";

const UI_ERROR_BINDING = "__e2eReportUiError";
const UNAUTHORIZED = 401;

// Runs in the page before any app script. Error toasts (vue-sonner) disappear after a few seconds,
// so they are reported the moment they appear; shadcn alerts count only in their destructive
// variant, because the same role="alert" is used for plain notices too.
const UI_ERROR_OBSERVER = `(() => {
  const ERROR_TOAST = '[data-sonner-toast][data-type="error"]';
  const ALERT = '[role="alert"]';
  const seen = new WeakSet();
  const report = (text) => {
    try { window.${UI_ERROR_BINDING}(text); } catch (error) {}
  };
  const kindOf = (element) => {
    if (element.matches(ERROR_TOAST)) return "error toast";
    const classes = typeof element.className === "string" ? element.className : "";
    if (element.matches(ALERT) && /\\btext-destructive\\b/.test(classes)) return "error alert";
    return null;
  };
  const inspect = (element) => {
    const kind = kindOf(element);
    if (kind === null || seen.has(element)) return;
    seen.add(element);
    // The message renders a moment after the element itself.
    setTimeout(() => {
      const text = (element.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 200);
      report(kind + ": " + (text || "(no text)"));
    }, 300);
  };
  const scan = (node) => {
    if (!(node instanceof Element)) return;
    inspect(node);
    node.querySelectorAll(ERROR_TOAST + ", " + ALERT).forEach(inspect);
  };
  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "attributes") {
        if (mutation.target instanceof Element) inspect(mutation.target);
        continue;
      }
      mutation.addedNodes.forEach(scan);
    }
  }).observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-type", "class"],
  });
})();`;

/**
 * Records, for the whole test, what a user would see as an error: API 5xx/401/403, leaving the
 * app (a redirect to the login page) and error toasts or destructive alerts. API 429s are kept
 * apart: they come from the run's own pace (the API rate limit), not from the app.
 */
export class ErrorMonitor implements IErrorMonitor {
  private readonly records: string[] = [];
  private readonly rateLimited: IRateLimitHit[] = [];
  private readonly ignore: RegExp[];
  private sessionLostNoticed = false;

  private constructor(
    private readonly page: Page,
    private readonly appOrigin: string,
    private readonly apiOrigin: string,
    private readonly notify: INotify
  ) {
    this.ignore = loadE2eConfig().error_monitor.ignore.map(
      (pattern) => new RegExp(pattern)
    );
  }

  static async attach(
    page: Page,
    appOrigin: string,
    apiOrigin: string,
    notify: INotify
  ): Promise<ErrorMonitor> {
    const monitor = new ErrorMonitor(page, appOrigin, apiOrigin, notify);
    await page.exposeFunction(UI_ERROR_BINDING, (text: unknown) =>
      monitor.record(String(text))
    );
    await page.addInitScript(UI_ERROR_OBSERVER);
    page.on("response", (response) => monitor.onResponse(response));
    page.on("framenavigated", (frame) => monitor.onNavigation(frame));
    return monitor;
  }

  /** What was recorded so far, minus what error_monitor.ignore in e2e.config.yaml lets through. */
  errors(): readonly string[] {
    return this.records.filter((record) => !this.isIgnored(record));
  }

  rateLimitHits(): readonly IRateLimitHit[] {
    return [...this.rateLimited];
  }

  clearRateLimitHits(): void {
    this.rateLimited.length = 0;
  }

  private record(text: string): void {
    this.records.push(text);
  }

  private isIgnored(text: string): boolean {
    return this.ignore.some((pattern) => pattern.test(text));
  }

  private onResponse(response: Response): void {
    if (!response.url().startsWith(this.apiOrigin)) {
      return;
    }
    const status = response.status();
    const request = `${response.request().method()} ${
      new URL(response.url()).pathname
    }`;
    if (status === TOO_MANY_REQUESTS) {
      this.rateLimited.push({
        request,
        retryAt: Date.now() + rateLimitPauseMs(response.headers(), 0),
      });
      return;
    }
    if (status >= 500 || status === UNAUTHORIZED || status === 403) {
      this.record(`${status} ${request}`);
    }
    // The app's own token stopped working: someone logged out of the QA account. Said once a test.
    if (
      status === UNAUTHORIZED &&
      !this.sessionLostNoticed &&
      !this.isIgnored(`${status} ${request}`)
    ) {
      this.sessionLostNoticed = true;
      this.notify(
        "session-lost",
        `${status} ${request}: the API no longer accepts the app's session`
      );
    }
  }

  private onNavigation(frame: Frame): void {
    if (frame !== this.page.mainFrame() || !frame.url().startsWith("http")) {
      return;
    }
    const url = new URL(frame.url());
    if (url.origin !== this.appOrigin) {
      this.record(
        `left the app for ${url.origin}${url.pathname} (a login redirect?)`
      );
    }
  }
}
