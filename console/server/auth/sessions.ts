import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { SESSION_IDLE_MS, SESSION_MAX_MS } from "../settings";

// Signed-in browsers. A session is a random token in a cookie; the console keeps only its SHA-256
// with the email, on disk (<data dir>/state/sessions.json), so sessions outlive a restart. A
// session ends 12 hours after sign-in or after 2 idle hours.

// Activity is written at most this often (a sign-in or sign-out at once).
const SAVE_DELAY_MS = 60_000;

const sessionSchema = z.object({
  email: z.string(),
  createdAt: z.number(),
  lastSeenAt: z.number(),
});

const storeSchema = z.object({
  sessions: z.record(z.string(), sessionSchema),
});

type ISession = z.infer<typeof sessionSchema>;

function hashOf(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function isLive(session: ISession, now: number): boolean {
  return (
    now - session.createdAt < SESSION_MAX_MS &&
    now - session.lastSeenAt < SESSION_IDLE_MS
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class SessionStore {
  private readonly sessions = new Map<string, ISession>();
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(private readonly file: string) {
    this.load();
  }

  /** Starts a session for a signed-in email; the token goes into its cookie. */
  create(email: string): string {
    const token = crypto.randomBytes(32).toString("base64url");
    const now = Date.now();
    this.sessions.set(hashOf(token), {
      email,
      createdAt: now,
      lastSeenAt: now,
    });
    this.save();
    return token;
  }

  /** The email of a live session, counting this as its activity; null: none, or it is over. */
  use(token: string): string | null {
    const session = this.live(token);
    if (session === null) {
      return null;
    }
    session.lastSeenAt = Date.now();
    this.saveLater();
    return session.email;
  }

  /** The same without counting as activity (an open event stream asks this). */
  peek(token: string): string | null {
    return this.live(token)?.email ?? null;
  }

  end(token: string): void {
    if (this.sessions.delete(hashOf(token))) {
      this.save();
    }
  }

  /** Writes activity that is still only in memory (the console stops). */
  flush(): void {
    if (this.saveTimer !== null) {
      this.save();
    }
  }

  private live(token: string): ISession | null {
    const key = hashOf(token);
    const session = this.sessions.get(key);
    if (session === undefined) {
      return null;
    }
    if (!isLive(session, Date.now())) {
      this.sessions.delete(key);
      this.save();
      return null;
    }
    return session;
  }

  private load(): void {
    let data: unknown;
    try {
      data = JSON.parse(fs.readFileSync(this.file, "utf8"));
    } catch {
      // None yet, or unreadable: everybody signs in again.
      return;
    }
    const parsed = storeSchema.safeParse(data);
    if (!parsed.success) {
      console.error(`✗ ${this.file} is not a sessions file; starting without`);
      return;
    }
    const now = Date.now();
    for (const [key, session] of Object.entries(parsed.data.sessions)) {
      if (isLive(session, now)) {
        this.sessions.set(key, session);
      }
    }
  }

  private saveLater(): void {
    if (this.saveTimer === null) {
      this.saveTimer = setTimeout(() => this.save(), SAVE_DELAY_MS);
      this.saveTimer.unref();
    }
  }

  private save(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const temporary = `${this.file}.${process.pid}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(
        temporary,
        JSON.stringify({ sessions: Object.fromEntries(this.sessions) }),
        { mode: 0o600 }
      );
      fs.renameSync(temporary, this.file);
    } catch (error) {
      console.error(`✗ The sessions could not be saved: ${messageOf(error)}`);
    }
  }
}
