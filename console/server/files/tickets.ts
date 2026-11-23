import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// Run files on their own origin carry no session: the console hands out a ticket in the path
// (/t/<ticket>/runs/<id>/…) for one run, signed with a secret kept on the data volume, good for
// two hours. "report" opens the report, traces and attachments; "watch" only the screenshots.

export const TICKET_SCOPES = ["watch", "report"] as const;
export type ITicketScope = (typeof TICKET_SCOPES)[number];

const TICKET_TTL_MS = 2 * 60 * 60_000;
const SECRET_BYTES = 32;
const TICKET =
  /^(?<expires>\d{1,12})\.(?<scope>watch|report)\.(?<mac>[\w-]{43})$/;

// What each scope opens.
const OPENS: Record<ITicketScope, ReadonlySet<ITicketScope>> = {
  watch: new Set(["watch"]),
  report: new Set(["watch", "report"]),
};

function isScope(value: string): value is ITicketScope {
  return TICKET_SCOPES.some((scope) => scope === value);
}

// Made once, kept across restarts (tickets stay good), readable by the console only.
function readSecret(file: string): Buffer {
  try {
    return fs.readFileSync(file);
  } catch {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, crypto.randomBytes(SECRET_BYTES), {
      mode: 0o600,
    });
    fs.renameSync(temporary, file);
    return fs.readFileSync(file);
  }
}

export class FileTickets {
  private readonly secret: Buffer;

  constructor(secretFile: string) {
    this.secret = readSecret(secretFile);
  }

  issue(runId: string, scope: ITicketScope): string {
    const expires = Math.floor((Date.now() + TICKET_TTL_MS) / 1000);
    return `${expires}.${scope}.${this.mac(runId, scope, expires)}`;
  }

  /** Whether `ticket` opens `needed` files of run `runId` now. */
  opens(ticket: string, runId: string, needed: ITicketScope): boolean {
    const groups = TICKET.exec(ticket)?.groups;
    const scope = groups?.scope ?? "";
    const expires = Number(groups?.expires);
    if (
      groups === undefined ||
      !isScope(scope) ||
      expires * 1000 < Date.now()
    ) {
      return false;
    }
    const given = Buffer.from(groups.mac ?? "");
    const expected = Buffer.from(this.mac(runId, scope, expires));
    return (
      given.length === expected.length &&
      crypto.timingSafeEqual(given, expected) &&
      OPENS[scope].has(needed)
    );
  }

  private mac(runId: string, scope: ITicketScope, expires: number): string {
    return crypto
      .createHmac("sha256", this.secret)
      .update(`${runId}\n${scope}\n${expires}`)
      .digest("base64url");
  }
}
