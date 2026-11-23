import crypto from "node:crypto";
import { z } from "zod";
import type { ISignInProblem } from "../../shared/types";
import { IDP_TIMEOUT_MS, SIGN_IN_TTL_MS } from "../settings";
import type { ILoginSettings } from "../types";

// Sign-in with an account of the app: the OAuth 2 authorization code flow with PKCE, as a public client
// of the app's IdP (Laravel Passport; it skips its consent screen). The browser goes to the IdP
// and comes back to /auth/callback with a code; the console trades the code for a token, asks the
// API whose it is, revokes it and keeps only the email. `state` ties the callback to the browser
// that started the sign-in, which also holds it in a cookie.

// Sign-ins that never came back are forgotten after SIGN_IN_TTL_MS, and beyond this many.
const MAX_PENDING = 500;

const tokenSchema = z.object({ access_token: z.string().min(1) });

// GET /api/auth (UserResource, wrapped in "data").
const userSchema = z.object({
  data: z.object({
    email: z.string().min(1),
    email_verified_at: z.string().nullable(),
    is_impersonation: z.boolean(),
  }),
});

interface IPendingSignIn {
  verifier: string;
  returnTo: string;
  startedAt: number;
}

export interface ISignedIn {
  email: string;
  returnTo: string;
}

/** A sign-in that did not work: what the person is told, and what the audit log keeps. */
export class SignInError extends Error {
  constructor(
    readonly problem: ISignInProblem,
    message: string,
    readonly email: string | null = null
  ) {
    super(message);
  }
}

function randomToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function challengeOf(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

export class OAuthClient {
  private readonly pending = new Map<string, IPendingSignIn>();

  constructor(private readonly login: ILoginSettings) {}

  /** A new sign-in: its state (for the browser's cookie) and where the browser goes. */
  begin(returnTo: string): { state: string; authorizeUrl: string } {
    this.forgetOld();
    const state = randomToken();
    const verifier = randomToken();
    this.pending.set(state, { verifier, returnTo, startedAt: Date.now() });
    // No scope: Passport gives its default one.
    const query = new URLSearchParams({
      client_id: this.login.clientId,
      redirect_uri: this.login.redirectUri,
      response_type: "code",
      state,
      code_challenge: challengeOf(verifier),
      code_challenge_method: "S256",
    });
    return {
      state,
      authorizeUrl: `${this.login.idpUrl}/oauth/authorize?${query.toString()}`,
    };
  }

  /** The IdP sent the browser back: whose account it is, and where the browser was going. */
  async finish(
    query: URLSearchParams,
    browserState: string | null
  ): Promise<ISignedIn> {
    const state = query.get("state");
    const pending = state === null ? undefined : this.pending.get(state);
    if (state === null || pending === undefined || browserState !== state) {
      throw new SignInError("expired", "unknown state, or not this browser's");
    }
    this.pending.delete(state);
    if (Date.now() - pending.startedAt > SIGN_IN_TTL_MS) {
      throw new SignInError("expired", "the sign-in took too long");
    }
    const refused = query.get("error");
    if (refused !== null) {
      throw new SignInError(
        "refused",
        `the IdP answered ${refused}: ${query.get("error_description") ?? ""}`
      );
    }
    const code = query.get("code");
    if (code === null || code === "") {
      throw new SignInError("refused", "the IdP sent no code");
    }
    const token = await this.token(code, pending.verifier);
    try {
      return { email: await this.emailOf(token), returnTo: pending.returnTo };
    } finally {
      await this.revoke(token);
    }
  }

  private async token(code: string, verifier: string): Promise<string> {
    const response = await this.call(`${this.login.idpUrl}/oauth/token`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: this.login.clientId,
        redirect_uri: this.login.redirectUri,
        code_verifier: verifier,
        code,
      }).toString(),
    });
    const parsed = tokenSchema.safeParse(
      await response.json().catch(() => null)
    );
    if (!response.ok || !parsed.success) {
      throw new SignInError(
        "refused",
        `POST /oauth/token answered ${response.status}`
      );
    }
    return parsed.data.access_token;
  }

  private async emailOf(token: string): Promise<string> {
    const response = await this.call(`${this.login.idpApiUrl}/api/auth`, {
      headers: { accept: "application/json", authorization: `Bearer ${token}` },
    });
    const parsed = userSchema.safeParse(
      await response.json().catch(() => null)
    );
    if (!response.ok || !parsed.success) {
      throw new SignInError(
        "unreachable",
        `GET /api/auth answered ${response.status}${
          response.ok ? " without an email" : ""
        }`
      );
    }
    const user = parsed.data.data;
    const email = user.email.toLowerCase();
    if (user.is_impersonation) {
      throw new SignInError("impersonated", "an impersonated session", email);
    }
    if (user.email_verified_at === null) {
      throw new SignInError("unverified", "the email is not verified", email);
    }
    return email;
  }

  // The console keeps only the email: the token goes at once (best effort).
  private async revoke(token: string): Promise<void> {
    try {
      const response = await this.call(
        `${this.login.idpApiUrl}/api/auth/token/revoke`,
        {
          method: "POST",
          headers: {
            accept: "application/json",
            authorization: `Bearer ${token}`,
          },
        }
      );
      if (!response.ok) {
        console.error(`✗ The IdP token was not revoked (${response.status})`);
      }
    } catch (error) {
      console.error(
        `✗ The IdP token was not revoked: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private async call(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(url, {
        ...init,
        redirect: "manual",
        signal: AbortSignal.timeout(IDP_TIMEOUT_MS),
      });
    } catch (error) {
      throw new SignInError(
        "unreachable",
        `${new URL(url).host} did not answer: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private forgetOld(): void {
    const now = Date.now();
    for (const [state, pending] of this.pending) {
      if (now - pending.startedAt > SIGN_IN_TTL_MS) {
        this.pending.delete(state);
      }
    }
    for (const state of this.pending.keys()) {
      if (this.pending.size < MAX_PENDING) {
        return;
      }
      this.pending.delete(state);
    }
  }
}
