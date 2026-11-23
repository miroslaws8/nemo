import { ciPipelineSchema, sweepReportSchema } from "@shared/api";
import type { ICiPipeline, ISweepResult } from "@shared/types";
import { useRouter } from "vue-router";
import { toast } from "vue-sonner";
import { messageOf, postJson } from "@/lib/api";
import { ciTitle } from "@/lib/ci";
import { ciPath } from "@/lib/paths";
import { upsertCiPipeline } from "@/state/ci";

// What a CI pipeline's buttons do, through the console (which holds the Bitbucket token).

function pipelineUrl(pipeline: ICiPipeline, action: string): string {
  return `/api/ci/pipelines/${pipeline.number}/${action}`;
}

export function useCiActions(): {
  stop: (pipeline: ICiPipeline) => Promise<void>;
  rerun: (
    pipeline: ICiPipeline,
    confirm: string | undefined
  ) => Promise<boolean>;
  cleanup: (
    pipeline: ICiPipeline,
    apply: boolean,
    confirm: string | undefined
  ) => Promise<ISweepResult | null>;
} {
  const router = useRouter();

  async function stop(pipeline: ICiPipeline): Promise<void> {
    try {
      upsertCiPipeline(
        await postJson(pipelineUrl(pipeline, "stop"), {}, ciPipelineSchema)
      );
      toast.success(`Stopping ${ciTitle(pipeline)}`);
    } catch (failure) {
      toast.error(messageOf(failure));
    }
  }

  async function rerun(
    pipeline: ICiPipeline,
    confirm: string | undefined
  ): Promise<boolean> {
    try {
      const started = await postJson(
        pipelineUrl(pipeline, "rerun"),
        confirm === undefined ? {} : { confirm },
        ciPipelineSchema
      );
      upsertCiPipeline(started);
      toast.success(`Started ${ciTitle(started)}`);
      await router.push(ciPath(started.number));
      return true;
    } catch (failure) {
      toast.error(messageOf(failure));
      return false;
    }
  }

  async function cleanup(
    pipeline: ICiPipeline,
    apply: boolean,
    confirm: string | undefined
  ): Promise<ISweepResult | null> {
    try {
      return await postJson(
        pipelineUrl(pipeline, "cleanup"),
        confirm === undefined ? { apply } : { apply, confirm },
        sweepReportSchema
      );
    } catch (failure) {
      toast.error(messageOf(failure));
      return null;
    }
  }

  return { stop, rerun, cleanup };
}
