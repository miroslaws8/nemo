import { runRecordSchema, sweepReportSchema } from "@shared/api";
import type {
  IRetryRequest,
  IRunRecord,
  IStartAgentRunRequest,
  IStartRunRequest,
  ISweepResult,
} from "@shared/types";
import { useRouter } from "vue-router";
import { toast } from "vue-sonner";
import { messageOf, postJson } from "@/lib/api";
import { runPath } from "@/lib/paths";
import { upsertRun } from "@/state/runs";

// What the buttons do: start runs and agent checks, stop, retry and clean up. A failure becomes a toast with the
// server's own message; a new run opens right away.

function runUrl(run: IRunRecord, action: string): string {
  return `/api/runs/${encodeURIComponent(run.id)}/${action}`;
}

export function useRunActions(): {
  start: (request: IStartRunRequest) => Promise<boolean>;
  startAgent: (request: IStartAgentRunRequest) => Promise<boolean>;
  stop: (run: IRunRecord, force: boolean) => Promise<void>;
  retry: (run: IRunRecord, request: IRetryRequest) => Promise<boolean>;
  cleanup: (
    run: IRunRecord,
    apply: boolean,
    confirm: string | undefined
  ) => Promise<ISweepResult | null>;
} {
  const router = useRouter();

  async function open(record: IRunRecord, verb: string): Promise<void> {
    upsertRun(record);
    toast.success(
      record.status === "queued"
        ? `${verb} — waits for the run on ${record.env} to finish`
        : verb
    );
    await router.push(runPath(record.id));
  }

  async function start(request: IStartRunRequest): Promise<boolean> {
    try {
      const record = await postJson("/api/runs", request, runRecordSchema);
      await open(record, "Run queued");
      return true;
    } catch (failure) {
      toast.error(messageOf(failure));
      return false;
    }
  }

  async function startAgent(request: IStartAgentRunRequest): Promise<boolean> {
    try {
      const record = await postJson(
        "/api/agent-runs",
        request,
        runRecordSchema
      );
      await open(record, "Agent check queued");
      return true;
    } catch (failure) {
      toast.error(messageOf(failure));
      return false;
    }
  }

  async function stop(run: IRunRecord, force: boolean): Promise<void> {
    try {
      upsertRun(
        await postJson(runUrl(run, "stop"), { force }, runRecordSchema)
      );
    } catch (failure) {
      toast.error(messageOf(failure));
    }
  }

  async function retry(
    run: IRunRecord,
    request: IRetryRequest
  ): Promise<boolean> {
    try {
      const record = await postJson(
        runUrl(run, "retry"),
        request,
        runRecordSchema
      );
      await open(record, "Retry queued");
      return true;
    } catch (failure) {
      toast.error(messageOf(failure));
      return false;
    }
  }

  async function cleanup(
    run: IRunRecord,
    apply: boolean,
    confirm: string | undefined
  ): Promise<ISweepResult | null> {
    try {
      return await postJson(
        runUrl(run, "cleanup"),
        confirm === undefined ? { apply } : { apply, confirm },
        sweepReportSchema
      );
    } catch (failure) {
      toast.error(messageOf(failure));
      return null;
    }
  }

  return { start, startAgent, stop, retry, cleanup };
}
