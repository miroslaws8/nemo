import fs from "node:fs";
import { liveEventSchema } from "../../engine/reporters/live-events";
import type { ILiveEvent } from "../../engine/types";

// Follows a run's events.ndjson while the run writes it. fs.watch is quick but can miss changes,
// so the size is also checked on a timer; a line is used only once its newline is there.

const POLL_MS = 500;
const NEWLINE = 0x0a;

function parseLine(line: string): ILiveEvent | null {
  if (line.trim() === "") {
    return null;
  }
  try {
    const parsed = liveEventSchema.safeParse(JSON.parse(line));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Every valid event of a finished run, in file order. */
export function readAllEvents(file: string): ILiveEvent[] {
  if (!fs.existsSync(file)) {
    return [];
  }
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .flatMap((line) => {
      const event = parseLine(line);
      return event === null ? [] : [event];
    });
}

export class NdjsonTail {
  private offset = 0;
  private pending: Buffer = Buffer.alloc(0);
  private watcher: fs.FSWatcher | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly file: string,
    private readonly onEvent: (event: ILiveEvent) => void
  ) {}

  start(): void {
    this.readMore();
    this.timer = setInterval(() => this.readMore(), POLL_MS);
  }

  /** Reads what is left and stops following. */
  stop(): void {
    this.readMore();
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.watcher?.close();
    this.watcher = null;
  }

  private watch(): void {
    if (this.watcher !== null || !fs.existsSync(this.file)) {
      return;
    }
    try {
      this.watcher = fs.watch(this.file, () => this.readMore());
    } catch {
      this.watcher = null;
    }
  }

  private readMore(): void {
    this.watch();
    let size: number;
    try {
      size = fs.statSync(this.file).size;
    } catch {
      return;
    }
    if (size <= this.offset) {
      return;
    }

    const chunk = Buffer.alloc(size - this.offset);
    const descriptor = fs.openSync(this.file, "r");
    try {
      fs.readSync(descriptor, chunk, 0, chunk.length, this.offset);
    } finally {
      fs.closeSync(descriptor);
    }
    this.offset = size;
    this.consume(chunk);
  }

  // Split on newline bytes, not characters: a chunk can end inside a multibyte character.
  private consume(chunk: Buffer): void {
    const data = Buffer.concat([this.pending, chunk]);
    const lastNewline = data.lastIndexOf(NEWLINE);
    if (lastNewline === -1) {
      this.pending = data;
      return;
    }
    this.pending = data.subarray(lastNewline + 1);
    for (const line of data
      .subarray(0, lastNewline)
      .toString("utf8")
      .split("\n")) {
      const event = parseLine(line);
      if (event !== null) {
        this.onEvent(event);
      }
    }
  }
}
