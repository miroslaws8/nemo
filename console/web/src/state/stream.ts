import {
  ciOverviewSchema,
  liveEventSchema,
  removedRunsSchema,
  runRecordSchema,
} from "@shared/api";
import { emptyRunState, reduceRun } from "@shared/reducer";
import type { ILiveEvent, IRunState } from "@shared/types";
import { reactive, ref } from "vue";
import type { IConnectionState } from "@/types";
import { applyCi, loadCi } from "./ci";
import { reloadRuns, removeRuns, upsertRun } from "./runs";
import { checkSession } from "./session";

// One server-sent-events connection per tab (GET /api/stream): "run" events keep the run list
// current, "live" events rebuild the open run with the reducer the server uses too. Events are
// applied in small batches, so a long run's backlog renders once rather than once per event.
// The reducer skips events it has already seen (by seq), so replays after a reconnect are safe.

const BATCH_MS = 40;
const RECONNECT_MS = 3000;

export const connection = ref<IConnectionState>("connecting");
/** The run whose events this tab follows; null follows the run list only. */
export const followedRunId = ref<string | null>(null);
/** The followed run, as its events tell it. */
export const liveRun = reactive<IRunState>(emptyRunState());
/** The followed run's events so far have all arrived (the server said "ready"). */
export const liveReady = ref(false);

let source: EventSource | null = null;
let pending: ILiveEvent[] = [];
let batchTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function dataOf(message: MessageEvent): unknown {
  const data: unknown = message.data;
  if (typeof data !== "string") {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(data);
    return parsed;
  } catch {
    return null;
  }
}

function applyPending(): void {
  if (batchTimer !== null) {
    clearTimeout(batchTimer);
    batchTimer = null;
  }
  const events = pending;
  pending = [];
  for (const event of events) {
    reduceRun(liveRun, event);
  }
}

function onLive(message: MessageEvent): void {
  const parsed = liveEventSchema.safeParse(dataOf(message));
  if (!parsed.success) {
    return;
  }
  pending.push(parsed.data);
  if (batchTimer === null) {
    batchTimer = setTimeout(applyPending, BATCH_MS);
  }
}

function onRun(message: MessageEvent): void {
  const parsed = runRecordSchema.safeParse(dataOf(message));
  if (!parsed.success) {
    return;
  }
  // The server sends a run's last events before its final record: show them first.
  if (parsed.data.id === followedRunId.value) {
    applyPending();
  }
  upsertRun(parsed.data);
}

function onCi(message: MessageEvent): void {
  const parsed = ciOverviewSchema.safeParse(dataOf(message));
  if (parsed.success) {
    applyCi(parsed.data);
  }
}

function onRemoved(message: MessageEvent): void {
  const parsed = removedRunsSchema.safeParse(dataOf(message));
  if (parsed.success) {
    removeRuns(parsed.data.ids);
  }
}

function streamUrl(): string {
  const query = new URLSearchParams();
  const runId = followedRunId.value;
  if (runId !== null) {
    query.set("run", runId);
    // A reconnect of the same run asks only for what it has not seen yet.
    if (liveRun.lastSeq >= 0) {
      query.set("after", String(liveRun.lastSeq));
    }
  }
  const search = query.toString();
  return search === "" ? "/api/stream" : `/api/stream?${search}`;
}

function scheduleReconnect(): void {
  if (reconnectTimer === null) {
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, RECONNECT_MS);
  }
}

function connect(): void {
  applyPending();
  source?.close();
  const opened = new EventSource(streamUrl());
  source = opened;
  connection.value = "connecting";
  opened.addEventListener("open", () => {
    connection.value = "open";
    reloadRuns().catch(() => undefined);
    loadCi().catch(() => undefined);
  });
  opened.addEventListener("error", () => {
    if (opened !== source) {
      return;
    }
    // CONNECTING: the browser retries by itself. CLOSED: it gave up, so start over later —
    // after asking whether the session is over (a 401 signs the tab in again).
    if (opened.readyState === EventSource.CLOSED) {
      connection.value = "lost";
      checkSession();
      scheduleReconnect();
      return;
    }
    connection.value = "connecting";
  });
  opened.addEventListener("run", onRun);
  opened.addEventListener("removed", onRemoved);
  opened.addEventListener("ci", onCi);
  opened.addEventListener("live", onLive);
  opened.addEventListener("ready", () => {
    applyPending();
    liveReady.value = true;
  });
}

/** Closes the stream (signed out); followRun opens it again. */
export function closeStream(): void {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  source?.close();
  source = null;
}

/** Follows another run (or none); the first call opens the stream. */
export function followRun(runId: string | null): void {
  if (source !== null && followedRunId.value === runId) {
    return;
  }
  pending = [];
  if (batchTimer !== null) {
    clearTimeout(batchTimer);
    batchTimer = null;
  }
  followedRunId.value = runId;
  Object.assign(liveRun, emptyRunState());
  liveReady.value = false;
  connect();
}
