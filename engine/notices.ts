import type { TestInfo } from "@playwright/test";
import type { INoticeKind, INotify } from "./types";

// What the people watching a run should know beyond pass/fail, as it happens: the API's rate limit
// slowing the run down, or the QA account's session gone (logging out of the account ends every
// session, the run's too). A notice travels as an attachment "notice:<kind>": the live reporter
// turns it into a "test.notice" event for the console, and the HTML report lists it with the test.

export const NOTICE_ATTACHMENT_PREFIX = "notice:";

/** The test's notifier. Attaching is best-effort: a notice never fails or holds up a test. */
export function notifier(testInfo: TestInfo): INotify {
  return (kind: INoticeKind, message: string) => {
    testInfo
      .attach(`${NOTICE_ATTACHMENT_PREFIX}${kind}`, {
        body: message,
        contentType: "text/plain",
      })
      .catch(() => undefined);
  };
}
