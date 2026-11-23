import { loadE2eConfig } from "../config";
import type { IOwnedRecord } from "../types";

/**
 * Why a record must not be deleted, or null when it may be: its live title must carry the test
 * data prefix, must not be protected, and the test user must own it.
 */
export function deletionRefusal(
  record: IOwnedRecord,
  testUserId: number
): string | null {
  const { safety } = loadE2eConfig();

  if (!record.title.startsWith(safety.data_prefix)) {
    return `title "${record.title}" does not start with "${safety.data_prefix}"`;
  }
  if (safety.protected_titles.some((title) => record.title.startsWith(title))) {
    return `title "${record.title}" is protected`;
  }
  if (record.ownerId !== testUserId) {
    return `owned by user ${String(
      record.ownerId
    )}, not the test user ${testUserId}`;
  }
  return null;
}
