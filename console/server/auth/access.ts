import type { IncomingMessage } from "node:http";
import path from "node:path";
import { SESSION_MAX_MS, SIGN_IN_TTL_MS } from "../settings";
import type {
  IAccessControl,
  IActor,
  IAuditEntry,
  IConsoleSettings,
  ILoginSettings,
  IRedirect,
  ISignIn,
} from "../types";
import { AuditLog } from "./audit";
import { clearCookie, readCookie, setCookie } from "./cookies";
import type { ICookieSpec } from "./cookies";
import { OAuthClient, SignInError } from "./oauth";
import { SessionStore } from "./sessions";
import { UserDirectory } from "./users";

// Who may use the console. Nobody signs in to a local one: its one user, on this machine, may do
// anything. A server console signs people in with their app account (oauth.ts), keeps a session
// per browser (sessions.ts) and gives each person the role the users file lists (users.ts).

const LOCAL_USER: IActor = { email: null, role: "operator", session: null };
const NOBODY: IActor = { email: null, role: null, session: null };

class LocalAccess implements IAccessControl {
  actorOf(): IActor {
    return LOCAL_USER;
  }

  stillAllowed(): boolean {
    return true;
  }

  redirectFor(): string | null {
    return null;
  }

  // Everything here is its one user's doing: nothing to keep apart.
  audit(): void {
    return;
  }

  close(): void {
    return;
  }
}

class SignedInAccess implements IAccessControl, ISignIn {
  private readonly sessions: SessionStore;
  private readonly users: UserDirectory;
  private readonly oauth: OAuthClient;
  private readonly log: AuditLog;
  private readonly publicHost: string;
  private readonly sessionCookie: ICookieSpec;
  // The sign-in's state, from /auth/login to /auth/callback.
  private readonly signInCookie: ICookieSpec;

  constructor(
    private readonly settings: IConsoleSettings,
    login: ILoginSettings
  ) {
    this.sessions = new SessionStore(
      path.join(settings.stateDir, "sessions.json")
    );
    this.users = new UserDirectory(login.usersFile);
    this.oauth = new OAuthClient(login);
    this.log = new AuditLog(path.join(settings.stateDir, "audit.ndjson"));
    this.publicHost = new URL(settings.publicUrl).host;
    const secure = login.secureCookies;
    this.sessionCookie = {
      name: secure ? "__Host-qa_session" : "qa_session",
      path: "/",
      secure,
    };
    this.signInCookie = {
      name: secure ? "__Secure-qa_sign_in" : "qa_sign_in",
      path: "/auth",
      secure,
    };
  }

  actorOf(request: IncomingMessage): IActor {
    const session = readCookie(request, this.sessionCookie.name);
    const email = session === null ? null : this.sessions.use(session);
    if (session === null || email === null) {
      return NOBODY;
    }
    return { email, role: this.users.roleOf(email), session };
  }

  stillAllowed(actor: IActor): boolean {
    return (
      actor.session !== null &&
      actor.email !== null &&
      this.sessions.peek(actor.session) !== null &&
      this.users.roleOf(actor.email) !== null
    );
  }

  // Pages only at the console's own address: its cookies and the IdP's redirect live there.
  redirectFor(request: IncomingMessage, url: URL): string | null {
    if (
      request.method !== "GET" ||
      url.pathname.startsWith("/api/") ||
      request.headers.host === this.publicHost
    ) {
      return null;
    }
    return `${this.settings.publicUrl}${url.pathname}${url.search}`;
  }

  begin(returnTo: string | null): IRedirect {
    const { state, authorizeUrl } = this.oauth.begin(this.returnTo(returnTo));
    return {
      location: authorizeUrl,
      cookies: [setCookie(this.signInCookie, state, SIGN_IN_TTL_MS)],
    };
  }

  async finish(
    request: IncomingMessage,
    query: URLSearchParams
  ): Promise<IRedirect> {
    const forgetState = clearCookie(this.signInCookie);
    try {
      const signedIn = await this.oauth.finish(
        query,
        readCookie(request, this.signInCookie.name)
      );
      const role = this.users.roleOf(signedIn.email);
      if (role === null) {
        throw new SignInError(
          "not-listed",
          "not in the users file",
          signedIn.email
        );
      }
      const session = this.sessions.create(signedIn.email);
      this.audit({
        email: signedIn.email,
        role,
        action: "sign-in",
        status: 200,
        detail: null,
      });
      return {
        location: signedIn.returnTo,
        cookies: [
          forgetState,
          setCookie(this.sessionCookie, session, SESSION_MAX_MS),
        ],
      };
    } catch (error) {
      if (!(error instanceof SignInError)) {
        throw error;
      }
      this.audit({
        email: error.email,
        role: null,
        action: "sign-in",
        status: 403,
        detail: `${error.problem}: ${error.message}`,
      });
      const page = new URLSearchParams({ problem: error.problem });
      if (error.email !== null) {
        page.set("email", error.email);
      }
      return {
        location: `/sign-in?${page.toString()}`,
        cookies: [forgetState],
      };
    }
  }

  signOut(actor: IActor): string[] {
    if (actor.session !== null) {
      this.sessions.end(actor.session);
      this.audit({
        email: actor.email,
        role: actor.role,
        action: "sign-out",
        status: 200,
        detail: null,
      });
    }
    return [clearCookie(this.sessionCookie)];
  }

  audit(entry: Omit<IAuditEntry, "ts">): void {
    this.log.write(entry);
  }

  close(): void {
    this.sessions.flush();
  }

  // Back where the sign-in started: a page at one of the console's addresses, else its home.
  private returnTo(requested: string | null): string {
    const home = `${this.settings.publicUrl}/`;
    if (requested === null) {
      return home;
    }
    try {
      const target = new URL(requested, home);
      const fits =
        this.settings.allowedOrigins.has(target.origin) &&
        !target.pathname.startsWith("/auth/");
      return fits ? target.href : home;
    } catch {
      return home;
    }
  }
}

/** The console's access control, and its sign-in where it has one (else its one local user). */
export function createAccess(settings: IConsoleSettings): {
  access: IAccessControl;
  signIn: ISignIn | null;
} {
  if (settings.login === null) {
    return { access: new LocalAccess(), signIn: null };
  }
  const signedIn = new SignedInAccess(settings, settings.login);
  return { access: signedIn, signIn: signedIn };
}
