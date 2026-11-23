import fs from "node:fs";
import path from "node:path";
import { expect, test as setup } from "@playwright/test";
import { getCredentials, getEnvironment } from "./environment";

const environment = getEnvironment();

// Logs in once per run and saves the session; every YAML test starts already logged in.
setup(`log in to ${environment.name}`, async ({ page }) => {
  const credentials = getCredentials(environment);

  await page.goto("/dashboard");
  await page.locator("input[type=email]").fill(credentials.email);
  const loginOrigin = new URL(page.url()).origin;
  await page.locator("input[type=password]").fill(credentials.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/dashboard**", { timeout: 90_000 });

  // The API lives on its own host (VITE_API_URL). It is learned from the app's own traffic on
  // every login, so a wrong api_url in e2e.config.yaml fails here instead of in every test.
  let detectedApiOrigin: string | null = null;
  page.on("request", (request) => {
    const url = new URL(request.url());
    const isApiCall =
      ["xhr", "fetch"].includes(request.resourceType()) &&
      url.pathname.includes("/api/");
    if (detectedApiOrigin === null && isApiCall && url.origin !== loginOrigin) {
      detectedApiOrigin = url.origin;
    }
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect
    .poll(() => detectedApiOrigin, {
      message: `Could not detect the API host — set api_url for ${environment.name} in e2e.config.yaml`,
      timeout: 30_000,
    })
    .not.toBeNull();

  const apiOrigin = environment.apiUrl ?? detectedApiOrigin;
  if (apiOrigin !== detectedApiOrigin) {
    throw new Error(
      `api_url for ${
        environment.name
      } is ${apiOrigin}, but the app calls ${String(
        detectedApiOrigin
      )} — fix e2e.config.yaml`
    );
  }

  fs.mkdirSync(path.dirname(environment.storageStatePath), { recursive: true });
  await page.context().storageState({ path: environment.storageStatePath });
  fs.writeFileSync(
    environment.sessionMetaPath,
    JSON.stringify({ apiOrigin }, null, 2)
  );
});
