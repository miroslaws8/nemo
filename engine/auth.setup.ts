import fs from "node:fs";
import path from "node:path";
import { test as setup } from "@playwright/test";
import { getCredentials, getEnvironment } from "./environment";

const environment = getEnvironment();
const SIGN_IN_TIMEOUT_MS = 90_000;

// Signs in once per run and saves the session; every YAML test starts signed in. An environment
// without credentials has no login project (playwright.config.ts).
//
// The usual email + password form: login.path (e2e.config.yaml) shows it or redirects to it (the
// app's own page or its IdP), the email and password inputs are filled, and its submit button —
// login.submit names it — is pressed. Signed in = back on the app (base_url's origin), past the
// form, and on login.done when it is set. An app with another sign-in (several steps, SSO)
// replaces this file.
setup(`log in to ${environment.name}`, async ({ page }) => {
  const credentials = getCredentials(environment);
  const appOrigin = new URL(environment.baseUrl).origin;

  await page.goto(environment.loginPath);
  await page.locator("input[type=email]").fill(credentials.email);
  const formUrl = page.url();
  await page.locator("input[type=password]").fill(credentials.password);
  const submit =
    environment.loginSubmit === null
      ? page.locator("button[type=submit]")
      : page.getByRole("button", {
          name: environment.loginSubmit,
          exact: true,
        });
  await submit.click();
  const donePath = environment.loginDone;
  await page.waitForURL(
    (url) =>
      url.origin === appOrigin &&
      url.href !== formUrl &&
      (donePath === null || url.pathname.startsWith(donePath)),
    { timeout: SIGN_IN_TIMEOUT_MS }
  );

  fs.mkdirSync(path.dirname(environment.storageStatePath), { recursive: true });
  await page.context().storageState({ path: environment.storageStatePath });
});
