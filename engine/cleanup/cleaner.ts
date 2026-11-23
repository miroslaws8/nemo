import type { ApiClient } from "../api-client";
import type {
  IDeletionOutcome,
  IOwnedRecord,
  ITrackedResource,
} from "../types";
import { gatewayFor } from "./gateways";
import { deletionRefusal } from "./guard";

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// A tracked id is read back live; a tracked title (data made through the UI) is looked up among
// the test user's own records.
async function findRecords(
  resource: ITrackedResource,
  api: ApiClient,
  testUserId: number
): Promise<IOwnedRecord[]> {
  const gateway = gatewayFor(resource.kind);
  if (resource.id !== null) {
    const record = await gateway.fetch(api, resource.id);
    return record === null ? [] : [record];
  }
  const owned = await gateway.listOwned(api, testUserId);
  return owned.filter((record) => record.title === resource.title);
}

async function deleteResource(
  resource: ITrackedResource,
  api: ApiClient,
  testUserId: number
): Promise<IDeletionOutcome[]> {
  try {
    const records = await findRecords(resource, api, testUserId);
    if (records.length === 0) {
      return [
        { resource, record: null, deleted: false, reason: "already gone" },
      ];
    }

    const outcomes: IDeletionOutcome[] = [];
    for (const record of records) {
      const refusal = deletionRefusal(record, testUserId);
      if (refusal !== null) {
        outcomes.push({ resource, record, deleted: false, reason: refusal });
        continue;
      }
      await gatewayFor(resource.kind).remove(api, record);
      outcomes.push({ resource, record, deleted: true, reason: null });
    }
    return outcomes;
  } catch (error) {
    return [
      { resource, record: null, deleted: false, reason: describeError(error) },
    ];
  }
}

/** Deletes what a test tracked, newest first; a failure is reported, never thrown. */
export async function deleteTracked(
  resources: readonly ITrackedResource[],
  api: ApiClient,
  testUserId: number
): Promise<IDeletionOutcome[]> {
  const outcomes: IDeletionOutcome[] = [];
  for (const resource of [...resources].reverse()) {
    outcomes.push(...(await deleteResource(resource, api, testUserId)));
  }
  return outcomes;
}
