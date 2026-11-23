import fs from "node:fs";
import type { ILogChunk } from "../../shared/types";
import { redact } from "../redact";
import { runFile } from "../run-store";

const LOG_CHUNK_BYTES = 256 * 1024;
const NEWLINE = 0x0a;

/** The run's console output from `offset` on, in whole lines while it still grows. */
export function readLog(id: string, offset: number): ILogChunk {
  const file = runFile(id, "console.log");
  let size: number;
  try {
    size = fs.statSync(file).size;
  } catch {
    return { offset: 0, text: "" };
  }
  const start = Math.min(Math.max(offset, 0), size);
  const buffer = Buffer.alloc(Math.min(size - start, LOG_CHUNK_BYTES));
  const descriptor = fs.openSync(file, "r");
  try {
    fs.readSync(descriptor, buffer, 0, buffer.length, start);
  } finally {
    fs.closeSync(descriptor);
  }
  const lastNewline = buffer.lastIndexOf(NEWLINE);
  const usable =
    lastNewline === -1 ? buffer : buffer.subarray(0, lastNewline + 1);
  return {
    offset: start + usable.length,
    text: redact(usable.toString("utf8")),
  };
}
