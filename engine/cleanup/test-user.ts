import type { ApiClient } from "../api-client";

/**
 * THE APP'S HOOK: the test user's id, as the app's records name their owner. The cleanup guard
 * deletes only records this user owns, so cleanup and `pnpm sweep` ask for it before they delete
 * anything — and only then: a run that tracked nothing never calls it.
 *
 * Write it for your app together with its gateways (./gateways.ts), e.g.
 *   return (await api.get("/api/me", z.object({ id: z.number() }))).id;
 */
export async function fetchTestUserId(api: ApiClient): Promise<number> {
  throw new Error(
    `engine/cleanup/test-user.ts: write fetchTestUserId for this app (its API at ${api.origin}) — cleanup needs to know which records the test user owns`
  );
}
