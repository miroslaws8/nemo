import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { isGuarded } from "./auth/permissions";
import {
  ENV_PROGRAM,
  GUARDED_RUNNER_USER,
  KILL_PROGRAM,
  RUNNER_USER,
} from "./settings";
import type {
  ICommandLine,
  IConsoleSettings,
  IRunnerKind,
  IRunners,
} from "./types";

// Who runs branch code (QA_CONSOLE_RUNNERS):
//   self — the console's own user (a developer's machine: the tests are their own code);
//   sudo — the server image's runner users, through sudo (console/runner-sudoers): qa-runner for
//          open environments, qa-runner-guarded for guarded ones (prod). A runner cannot read the
//          console's environment (its tokens, every QA account), its sessions or the files
//          secret; a staging runner cannot read prod's runs or sessions. Each runner writes only
//          in folders the console gives its group (its run, its snapshot, its sessions); the
//          console is in both groups, so it reads and removes what they write.

// A folder a runner writes in: its group's, new files join the group (setgid), nobody else's.
const SHARED_MODE = 0o2770;

interface ISystemUser {
  name: string;
  gid: number;
  home: string;
}

/** A user of /etc/passwd (null: none by that name). */
function systemUser(name: string): ISystemUser | null {
  let passwd: string;
  try {
    passwd = fs.readFileSync("/etc/passwd", "utf8");
  } catch {
    return null;
  }
  for (const line of passwd.split("\n")) {
    const [user, , , gid, , home] = line.split(":");
    if (user === name && gid !== undefined && home !== undefined) {
      return { name, gid: Number(gid), home };
    }
  }
  return null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Branch code runs as the console (a developer's machine). */
class SelfRunners implements IRunners {
  setUp(): string[] {
    return [];
  }

  node(env: string, args: string[]): ICommandLine {
    return this.command(env, process.execPath, args);
  }

  command(_env: string, program: string, args: string[]): ICommandLine {
    return { program, args };
  }

  variables(): Record<string, string> {
    return {};
  }

  authDir(): string | null {
    return null;
  }

  share(): void {
    return;
  }

  kill(): void {
    return;
  }
}

/** Branch code runs as the image's runner users (a server console). */
class SudoRunners implements IRunners {
  private readonly users: {
    open: ISystemUser | null;
    guarded: ISystemUser | null;
  };

  private readonly authRoot: string;
  // The console's own folders (its sessions and secrets, its cleanups' logins): no runner's.
  private readonly ownFolders: string[];

  constructor(private readonly dataDir: string, stateDir: string) {
    this.authRoot = path.join(dataDir, "runner-auth");
    this.ownFolders = [stateDir, path.join(dataDir, "auth")];
    this.users = {
      open: systemUser(RUNNER_USER),
      guarded: systemUser(GUARDED_RUNNER_USER),
    };
  }

  setUp(): string[] {
    const open = this.openFolders();
    if (open.length > 0) {
      return open;
    }
    for (const folder of this.ownFolders) {
      fs.mkdirSync(folder, { recursive: true });
      fs.chmodSync(folder, 0o700);
    }
    const groups = new Set(process.getgroups?.() ?? []);
    return [
      [RUNNER_USER, this.users.open] as const,
      [GUARDED_RUNNER_USER, this.users.guarded] as const,
    ].flatMap(([name, user]) => {
      if (user === null) {
        return [
          `QA_CONSOLE_RUNNERS=sudo: there is no user ${name} (the console's image makes it; elsewhere use QA_CONSOLE_RUNNERS=self)`,
        ];
      }
      if (!groups.has(user.gid)) {
        return [
          `QA_CONSOLE_RUNNERS=sudo: the console is not in the group of ${name}`,
        ];
      }
      try {
        execFileSync("sudo", ["-n", "-u", name, "--", "true"], {
          stdio: "ignore",
          timeout: 10_000,
        });
        return [];
      } catch (error) {
        return [
          `QA_CONSOLE_RUNNERS=sudo: the console cannot run commands as ${name} (${messageOf(
            error
          )}); on Kubernetes the container needs allowPrivilegeEscalation (sudo)`,
        ];
      }
    });
  }

  node(env: string, args: string[]): ICommandLine {
    return this.command(env, process.execPath, args);
  }

  command(env: string, program: string, args: string[]): ICommandLine {
    const user = this.userOf(env);
    // -E: the runner gets the environment the console hands it (console/runner-sudoers: SETENV).
    // Its own temporary folder (the image makes it) goes through env: glibc drops TMPDIR for a
    // setuid program, so sudo never sees it. A shared /tmp without the sticky bit (an emptyDir)
    // would let one runner move the other's files.
    return {
      program: "sudo",
      args: [
        "-n",
        "-E",
        "-u",
        user.name,
        "--",
        ENV_PROGRAM,
        `TMPDIR=${path.join(user.home, "tmp")}`,
        program,
        ...args,
      ],
    };
  }

  variables(env: string): Record<string, string> {
    const user = this.userOf(env);
    return { HOME: user.home, USER: user.name, LOGNAME: user.name };
  }

  authDir(env: string): string {
    const folder = path.join(this.authRoot, this.userOf(env).name);
    fs.mkdirSync(folder, { recursive: true });
    this.share(env, folder);
    return folder;
  }

  // The runner's group owns the folder (it was the console's, as each folder the console makes).
  share(env: string, folder: string): void {
    const { gid } = this.userOf(env);
    const stats = fs.statSync(folder);
    if (stats.gid === gid && (stats.mode & 0o7777) === SHARED_MODE) {
      return;
    }
    fs.chownSync(folder, stats.uid, gid);
    fs.chmodSync(folder, SHARED_MODE);
  }

  kill(env: string, targets: number[]): void {
    if (targets.length === 0) {
      return;
    }
    try {
      execFileSync(
        "sudo",
        [
          "-n",
          "-u",
          this.userOf(env).name,
          "--",
          KILL_PROGRAM,
          "-KILL",
          "--",
          ...targets.map(String),
        ],
        { stdio: "ignore", timeout: 10_000 }
      );
    } catch {
      // Some were gone, or are the console's own (it kills those itself).
    }
  }

  // A runner may not replace the console's folders: the data folder is nobody else's to write in,
  // and every folder above it is closed or sticky (/tmp-like). A volume that everyone may write
  // (some local provisioners) fails here; one given to the console's group (fsGroup) passes.
  private openFolders(): string[] {
    const problems: string[] = [];
    let folder = path.resolve(this.dataDir);
    for (let own = true; ; own = false) {
      const mode = fs.statSync(folder).mode;
      const othersWrite = (mode & 0o002) !== 0;
      if (othersWrite && (own || (mode & 0o1000) === 0)) {
        problems.push(
          `QA_CONSOLE_RUNNERS=sudo: every user may write in ${folder}, so a runner could replace the console's folders; give the volume to the console's group (fsGroup) instead of everyone (chmod o-w), or use QA_CONSOLE_RUNNERS=self`
        );
      }
      const parent = path.dirname(folder);
      if (parent === folder) {
        return problems;
      }
      folder = parent;
    }
  }

  // An environment the console no longer knows (an old run's): the guarded runner, the closed one.
  private userOf(env: string): ISystemUser {
    let guarded = true;
    try {
      guarded = isGuarded(env);
    } catch {
      // Kept as guarded.
    }
    const user = guarded ? this.users.guarded : this.users.open;
    if (user === null) {
      throw new Error("the runner users are missing (QA_CONSOLE_RUNNERS=sudo)");
    }
    return user;
  }
}

const RUNNERS: Record<IRunnerKind, (settings: IConsoleSettings) => IRunners> = {
  self: () => new SelfRunners(),
  sudo: (settings) => new SudoRunners(settings.dataDir, settings.stateDir),
};

export function createRunners(settings: IConsoleSettings): IRunners {
  return RUNNERS[settings.runners](settings);
}
