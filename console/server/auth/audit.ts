import fs from "node:fs";
import path from "node:path";
import type { IAuditEntry } from "../types";

// What people did in a server console, one JSON line each (<data dir>/state/audit.ndjson): every
// change they made or tried, every refusal, every sign-in and sign-out.

export class AuditLog {
  private failing = false;

  constructor(private readonly file: string) {}

  write(entry: Omit<IAuditEntry, "ts">): void {
    const line: IAuditEntry = { ts: new Date().toISOString(), ...entry };
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.appendFileSync(this.file, `${JSON.stringify(line)}\n`, {
        mode: 0o600,
      });
      this.failing = false;
    } catch (error) {
      if (!this.failing) {
        console.error(
          `✗ The audit log cannot be written: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
      this.failing = true;
    }
  }
}
