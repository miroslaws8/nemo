import { ACTIVE_CI_STATUSES, ciOverviewSchema } from "@shared/api";
import type { ICiOverview, ICiPipeline, ICiStatus } from "@shared/types";
import { ref } from "vue";
import { getJson } from "@/lib/api";

// The repository's e2e pipelines on Bitbucket (console/server/sources): loaded with the page and
// whenever the stream reconnects, kept current by the stream's "ci" event.

export const ciOverview = ref<ICiOverview | null>(null);

export async function loadCi(): Promise<void> {
  ciOverview.value = await getJson("/api/ci", ciOverviewSchema);
}

export function applyCi(overview: ICiOverview): void {
  ciOverview.value = overview;
}

/** A pipeline an action just changed or started, before the next poll brings it. */
export function upsertCiPipeline(pipeline: ICiPipeline): void {
  const overview = ciOverview.value;
  if (overview === null) {
    return;
  }
  const others = overview.pipelines.filter(
    (candidate) => candidate.number !== pipeline.number
  );
  ciOverview.value = {
    ...overview,
    pipelines: [pipeline, ...others].sort(
      (left, right) => right.number - left.number
    ),
  };
}

export function isActiveCiStatus(status: ICiStatus): boolean {
  return ACTIVE_CI_STATUSES.some((active) => active === status);
}

export function ciPipelineWithNumber(number: number): ICiPipeline | undefined {
  return ciOverview.value?.pipelines.find(
    (pipeline) => pipeline.number === number
  );
}

/** The CI pipeline going on an environment now, if any. */
export function activeCiOn(environment: string): ICiPipeline | undefined {
  return ciOverview.value?.pipelines.find(
    (pipeline) =>
      pipeline.env === environment && isActiveCiStatus(pipeline.status)
  );
}

/** The newest CI pipeline that tested an environment. */
export function latestCiOn(environment: string): ICiPipeline | undefined {
  return ciOverview.value?.pipelines.find(
    (pipeline) => pipeline.env === environment
  );
}
