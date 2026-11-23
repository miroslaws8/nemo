import { test as base, type TestInfo } from "@playwright/test";
import { ApiClient } from "./api-client";
import { authUserSchema } from "./api-schemas";
import { deleteTracked } from "./cleanup/cleaner";
import { loadE2eConfig } from "./config";
import { getEnvironment } from "./environment";
import { ErrorMonitor } from "./error-monitor";
import { notifier } from "./notices";
import { describeResource, ResourceRegistry } from "./resources";
import type {
  ICleanupPolicy,
  IE2eTestFixtures,
  IE2eWorkerFixtures,
  IQaUser,
  IResourceRegistry,
} from "./types";

const environment = getEnvironment();

// Cleanup gets its own time budget: it must still run when the test itself timed out.
const CLEANUP_TIMEOUT_MS = 120_000;

// e2e.config.yaml `cleanup`: an interrupted test (a stopped run) has its own policy.
function cleanupPolicy(testInfo: TestInfo): ICleanupPolicy {
  const { cleanup } = loadE2eConfig();
  if (testInfo.status === "interrupted") {
    return cleanup.on_interrupt;
  }
  return testInfo.status === testInfo.expectedStatus
    ? cleanup.on_pass
    : cleanup.on_fail;
}

// Runs after the test, so its outcome is final: delete or keep per e2e.config.yaml `cleanup`.
async function finishResources(
  registry: IResourceRegistry,
  api: ApiClient,
  qaUser: () => Promise<IQaUser>,
  testInfo: TestInfo
): Promise<void> {
  const tracked = registry.list();
  if (tracked.length === 0) {
    return;
  }

  if (cleanupPolicy(testInfo) === "keep") {
    for (const resource of tracked) {
      testInfo.annotations.push({
        type: "kept for debugging",
        description: describeResource(resource),
      });
    }
    return;
  }

  const { id: ownerId } = await qaUser();
  for (const outcome of await deleteTracked(tracked, api, ownerId)) {
    testInfo.annotations.push(
      outcome.deleted
        ? {
            type: "cleanup",
            description: `deleted ${describeResource(outcome.resource)}`,
          }
        : {
            type: "cleanup warning",
            description: `not deleted: ${describeResource(
              outcome.resource
            )} — ${outcome.reason ?? "unknown reason"}`,
          }
    );
  }
}

/** The YAML tests' `test`: an API client and a cleanup registry per test, the test user per worker (asked for when needed). */
export const test = base.extend<IE2eTestFixtures, IE2eWorkerFixtures>({
  qaUser: [
    async ({}, use) => {
      let user: Promise<IQaUser> | null = null;
      const fetchUser = async (): Promise<IQaUser> => {
        const api = await ApiClient.create(environment);
        try {
          const found = await api.get("/api/auth", authUserSchema);
          return { id: found.id };
        } finally {
          await api.dispose();
        }
      };
      await use(() => {
        user ??= fetchUser();
        return user;
      });
    },
    { scope: "worker" },
  ],

  api: async ({ page }, use, testInfo) => {
    const api = await ApiClient.create(
      environment,
      page.context(),
      notifier(testInfo)
    );
    await use(api);
    await api.dispose();
  },

  resources: [
    async ({ api, qaUser }, use, testInfo) => {
      const registry = new ResourceRegistry();
      await use(registry);
      await finishResources(registry, api, qaUser, testInfo);
    },
    { timeout: CLEANUP_TIMEOUT_MS },
  ],

  // Attached before the test opens any page, so it sees everything from the first navigation.
  errorMonitor: async ({ page, api }, use, testInfo) => {
    const appOrigin = new URL(environment.baseUrl).origin;
    await use(
      await ErrorMonitor.attach(page, appOrigin, api.origin, notifier(testInfo))
    );
  },
});
