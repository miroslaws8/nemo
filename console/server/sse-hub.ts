import type { IncomingMessage, ServerResponse } from "node:http";
import type { ILiveEvent } from "../../engine/types";
import type { ICiOverview, IRunRecord } from "../shared/types";
import type { ISseClient } from "./types";

// One server-sent-events connection per browser tab: changes to run records ("run"), runs deleted
// as old ("removed") and the CI pipelines ("ci") for the lists, and the live events ("live",
// id = seq) of the run the tab has open, its backlog first and then "ready". A reconnect passes
// the last seq it saw and gets only what came after. Every ping asks whether the tab may still
// listen (its session goes on, its person still has a role); one that may not is closed.

const PING_MS = 15_000;
const RECONNECT_MS = 2_000;
// A tab that reads slower than events come is dropped; it reconnects and gets the rest by seq.
const MAX_BUFFERED_BYTES = 1024 * 1024;

function message(name: string, data: string, id: number | null): string {
  const idLine = id === null ? "" : `id: ${id}\n`;
  return `event: ${name}\n${idLine}data: ${data}\n\n`;
}

export class SseHub {
  private readonly clients = new Set<ISseClient>();
  private readonly pinger = setInterval(() => this.ping(), PING_MS);

  constructor() {
    this.pinger.unref();
  }

  open(
    request: IncomingMessage,
    response: ServerResponse,
    runId: string | null,
    backlog: ILiveEvent[],
    stillAllowed: () => boolean
  ): void {
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // nginx (an ingress) would otherwise hold the events back in its buffer.
      "x-accel-buffering": "no",
    });
    response.write(`retry: ${RECONNECT_MS}\n\n`);
    for (const event of backlog) {
      response.write(message("live", JSON.stringify(event), event.seq));
    }
    // Everything so far is out; what follows comes as it happens.
    response.write(message("ready", "{}", null));
    // The backlog goes out whatever its size; the tab may then fall behind by the limit on top.
    const client: ISseClient = {
      response,
      runId,
      maxBufferedBytes: response.writableLength + MAX_BUFFERED_BYTES,
      stillAllowed,
    };
    this.clients.add(client);
    request.on("close", () => this.clients.delete(client));
  }

  publishEvent(runId: string, event: ILiveEvent): void {
    for (const client of this.clients) {
      if (client.runId === runId) {
        this.send(client, "live", JSON.stringify(event), event.seq);
      }
    }
  }

  publishRun(record: IRunRecord): void {
    for (const client of this.clients) {
      this.send(client, "run", JSON.stringify(record), null);
    }
  }

  publishCi(overview: ICiOverview): void {
    for (const client of this.clients) {
      this.send(client, "ci", JSON.stringify(overview), null);
    }
  }

  /** Someone has the run open now (a CI run's screenshots are worth sending then). */
  isWatched(runId: string): boolean {
    return [...this.clients].some((client) => client.runId === runId);
  }

  /** Tabs connected now: CI is polled only while someone looks. */
  clientCount(): number {
    return this.clients.size;
  }

  publishRemoved(ids: string[]): void {
    for (const client of this.clients) {
      this.send(client, "removed", JSON.stringify({ ids }), null);
    }
  }

  close(): void {
    clearInterval(this.pinger);
    for (const client of this.clients) {
      client.response.end();
    }
    this.clients.clear();
  }

  private send(
    client: ISseClient,
    name: string,
    data: string,
    id: number | null
  ): void {
    this.write(client, message(name, data, id));
  }

  private write(client: ISseClient, text: string): void {
    if (client.response.writableLength > client.maxBufferedBytes) {
      this.clients.delete(client);
      client.response.destroy();
      return;
    }
    client.response.write(text);
  }

  private ping(): void {
    for (const client of this.clients) {
      if (client.stillAllowed()) {
        this.write(client, ": ping\n\n");
      } else {
        this.clients.delete(client);
        client.response.end();
      }
    }
  }
}
