import fs from "node:fs";
import { parse } from "yaml";
import { z } from "zod";
import { ROLES } from "../../shared/api";
import type { IRole } from "../../shared/types";

// Who may use a server console, and as what: the users file (QA_CONSOLE_USERS_FILE), e.g.
//   users:
//     someone@example.com: operator
//     other@example.com: viewer
// It is read again whenever it changes (a ConfigMap update), so access changes without a restart.
// A file that cannot be read gives nobody a role until it is fixed (the console logs why).

const EMAIL = /^[^\s@]+@[^\s@]+$/;

const usersFileSchema = z.strictObject({
  users: z.record(z.string(), z.enum(ROLES)),
});

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The people of a users file and their roles, by lowercase email; throws what is wrong. */
export function readUsersFile(file: string): ReadonlyMap<string, IRole> {
  let data: unknown;
  try {
    data = parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${file}: ${messageOf(error)}`);
  }
  const parsed = usersFileSchema.safeParse(data);
  if (!parsed.success) {
    const problems = parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "the file"}: ${issue.message}`
    );
    throw new Error(`${file}: ${problems.join("; ")}`);
  }
  const users = new Map<string, IRole>();
  for (const [email, role] of Object.entries(parsed.data.users)) {
    const key = email.toLowerCase();
    if (!EMAIL.test(email)) {
      throw new Error(`${file}: users.${email} is not an email`);
    }
    if (users.has(key)) {
      throw new Error(`${file}: ${email} is listed twice`);
    }
    users.set(key, role);
  }
  return users;
}

export class UserDirectory {
  private stamp: string | null = null;
  private users: ReadonlyMap<string, IRole> = new Map();

  constructor(private readonly file: string) {}

  /** The role of an email; null: not listed (or the file cannot be read now). */
  roleOf(email: string): IRole | null {
    this.refresh();
    return this.users.get(email.toLowerCase()) ?? null;
  }

  private refresh(): void {
    let stamp: string;
    try {
      const stat = fs.statSync(this.file);
      stamp = `${stat.mtimeMs}:${stat.size}`;
    } catch {
      stamp = "missing";
    }
    if (stamp === this.stamp) {
      return;
    }
    this.stamp = stamp;
    try {
      this.users = readUsersFile(this.file);
    } catch (error) {
      this.users = new Map();
      console.error(
        `✗ The users file cannot be read, so nobody has a role: ${messageOf(
          error
        )}`
      );
    }
  }
}
