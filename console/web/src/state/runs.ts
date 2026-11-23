import { runListSchema } from "@shared/api";
import type { IRunRecord } from "@shared/types";
import { computed, ref } from "vue";
import { getJson } from "@/lib/api";
import { isActiveStatus } from "@/lib/status";

// Every run record (reports/runs/*/run.json), newest first. The event stream ("run" events) keeps
// it current; it is loaded again whenever the stream (re)connects, so nothing missed stays stale.

export const runs = ref<IRunRecord[]>([]);
export const runsLoaded = ref(false);

function newestFirst(left: IRunRecord, right: IRunRecord): number {
  return right.createdAt.localeCompare(left.createdAt);
}

export async function reloadRuns(): Promise<void> {
  runs.value = await getJson("/api/runs", runListSchema);
  runsLoaded.value = true;
}

export function upsertRun(record: IRunRecord): void {
  const index = runs.value.findIndex((run) => run.id === record.id);
  if (index === -1) {
    runs.value = [record, ...runs.value].sort(newestFirst);
    return;
  }
  runs.value.splice(index, 1, record);
}

/** Runs whose folders the console deleted as old (it keeps the newest 30). */
export function removeRuns(ids: string[]): void {
  const removed = new Set(ids);
  runs.value = runs.value.filter((run) => !removed.has(run.id));
}

export function runWithId(id: string): IRunRecord | undefined {
  return runs.value.find((run) => run.id === id);
}

/** Runs going now or waiting their turn. */
export const currentRuns = computed(() =>
  runs.value.filter(
    (run) => run.status === "queued" || isActiveStatus(run.status)
  )
);

/** The runs holding an environment now (the console's own and CI runs it follows). */
export function activeRunsOn(environment: string): IRunRecord[] {
  return runs.value.filter(
    (run) => run.env === environment && isActiveStatus(run.status)
  );
}

/** The run holding an environment now, if any. */
export function activeRunOn(environment: string): IRunRecord | undefined {
  return activeRunsOn(environment)[0];
}

export function queuedOn(environment: string): IRunRecord[] {
  return runs.value.filter(
    (run) => run.env === environment && run.status === "queued"
  );
}
