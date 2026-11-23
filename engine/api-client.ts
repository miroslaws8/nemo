import fs from "node:fs";
import {
  request,
  type APIRequestContext,
  type APIResponse,
  type BrowserContext,
} from "@playwright/test";
import { z } from "zod";
import { rateLimitPauseMs, sleep, TOO_MANY_REQUESTS } from "./rate-limit";
import type { IEnvironment, INotify } from "./types";

const storageStateSchema = z.object({
  cookies: z.array(z.object({ name: z.string(), value: z.string() })),
});

const NOT_FOUND = 404;
const UNAUTHORIZED = 401;

// The least to wait before each retry of a 429 (the API's longer advice wins). The API refuses
// before the route runs, so repeating even a POST does nothing twice.
const RATE_LIMIT_RETRY_FLOORS_MS = [2_000, 10_000, 30_000];

function readJsonFile(filePath: string): unknown {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `${filePath} is missing — the login project must run first`
    );
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

// A body wrapped in { data: … } (Laravel resources, JSON:API) is read as what it wraps.
function unwrapData(body: unknown): unknown {
  if (typeof body === "object" && body !== null && "data" in body) {
    return body.data;
  }
  return body;
}

function findToken(
  cookies: { name: string; value: string }[],
  cookieName: string
): string {
  const tokenCookie = cookies.find((cookie) => cookie.name === cookieName);
  if (!tokenCookie) {
    throw new Error(
      `No ${cookieName} cookie in the session (api_token_cookie in e2e.config.yaml)`
    );
  }
  return decodeURIComponent(tokenCookie.value);
}

/** Talks to the app's API (api_url, else the site's origin) as the signed-in test user. */
export class ApiClient {
  private constructor(
    private readonly context: APIRequestContext,
    private readonly environment: IEnvironment,
    private readonly browserContext: BrowserContext | null,
    readonly origin: string,
    private readonly notify: INotify | null
  ) {}

  /**
   * With a browser context, every call uses that browser's current token, so a session the app
   * refreshed during a long test still works for cleanup afterwards. Inside a test, `notify` tells
   * the console about rate limits and a lost session (engine/notices.ts).
   */
  static async create(
    environment: IEnvironment,
    browserContext: BrowserContext | null = null,
    notify: INotify | null = null
  ): Promise<ApiClient> {
    if (!environment.signsIn) {
      return ApiClient.signedOut(environment, notify);
    }
    const origin = environment.apiUrl ?? new URL(environment.baseUrl).origin;
    const context = await request.newContext({
      baseURL: origin,
      storageState: environment.storageStatePath,
      extraHTTPHeaders: {
        Accept: "application/json",
        Origin: environment.baseUrl,
        Referer: `${environment.baseUrl}/`,
      },
    });

    return new ApiClient(context, environment, browserContext, origin, notify);
  }

  /** No account, no session: the origin is api_url, else the site itself, and calls carry no token. */
  private static async signedOut(
    environment: IEnvironment,
    notify: INotify | null
  ): Promise<ApiClient> {
    const origin = environment.apiUrl ?? new URL(environment.baseUrl).origin;
    const context = await request.newContext({
      baseURL: origin,
      extraHTTPHeaders: { Accept: "application/json" },
    });
    return new ApiClient(context, environment, null, origin, notify);
  }

  async get<TSchema extends z.ZodType>(
    apiPath: string,
    schema: TSchema
  ): Promise<z.infer<TSchema>> {
    const label = `GET ${apiPath}`;
    const response = await this.send(label, (headers) =>
      this.context.get(apiPath, { headers })
    );
    return this.parse(response, schema, label);
  }

  /** Like get, but a 404 (deleted, or never existed) is null instead of an error. */
  async find<TSchema extends z.ZodType>(
    apiPath: string,
    schema: TSchema
  ): Promise<z.infer<TSchema> | null> {
    const label = `GET ${apiPath}`;
    const response = await this.send(label, (headers) =>
      this.context.get(apiPath, { headers })
    );
    if (response.status() === NOT_FOUND) {
      return null;
    }
    return this.parse(response, schema, label);
  }

  async post<TSchema extends z.ZodType>(
    apiPath: string,
    body: object,
    schema: TSchema
  ): Promise<z.infer<TSchema>> {
    const label = `POST ${apiPath}`;
    const response = await this.send(label, (headers) =>
      this.context.post(apiPath, { data: body, headers })
    );
    return this.parse(response, schema, label);
  }

  async delete(apiPath: string): Promise<void> {
    const label = `DELETE ${apiPath}`;
    const response = await this.send(label, (headers) =>
      this.context.delete(apiPath, { headers })
    );
    await this.readBody(response, label);
  }

  async dispose(): Promise<void> {
    await this.context.dispose();
  }

  // The session's cookies go along with every call; an app whose API wants a Bearer token names
  // the cookie that holds it (api_token_cookie). Read at the call, so a test that never calls the
  // API never needs it; inside a test, from the browser, whose app may have refreshed it.
  private async authorization(): Promise<Record<string, string>> {
    const cookieName = this.environment.apiTokenCookie;
    if (cookieName === null || !this.environment.signsIn) {
      return {};
    }
    const cookies =
      this.browserContext === null
        ? storageStateSchema.parse(
            readJsonFile(this.environment.storageStatePath)
          ).cookies
        : await this.browserContext.cookies();
    return { Authorization: `Bearer ${findToken(cookies, cookieName)}` };
  }

  /** Sends a request, waiting out the API's rate limit (429) between attempts. */
  private async send(
    label: string,
    sendRequest: (headers: Record<string, string>) => Promise<APIResponse>
  ): Promise<APIResponse> {
    for (const floorMs of RATE_LIMIT_RETRY_FLOORS_MS) {
      const response = await sendRequest(await this.authorization());
      if (response.status() !== TOO_MANY_REQUESTS) {
        return this.checkSession(response, label);
      }
      const pauseMs = rateLimitPauseMs(response.headers(), floorMs);
      const message = `${label} → 429 (API rate limit), retrying in ${Math.ceil(
        pauseMs / 1000
      )}s`;
      console.warn(message);
      this.notify?.("rate-limit", message);
      await response.dispose();
      await sleep(pauseMs);
    }
    return this.checkSession(
      await sendRequest(await this.authorization()),
      label
    );
  }

  // A 401 means the API no longer takes the QA account's session: someone logged out of it.
  private checkSession(response: APIResponse, label: string): APIResponse {
    if (response.status() === UNAUTHORIZED) {
      this.notify?.(
        "session-lost",
        `${label} → 401: the API no longer accepts the QA account's session`
      );
    }
    return response;
  }

  private async readBody(
    response: APIResponse,
    label: string
  ): Promise<unknown> {
    if (response.status() === TOO_MANY_REQUESTS) {
      throw new Error(
        `${label} → 429: still over the API rate limit after ${RATE_LIMIT_RETRY_FLOORS_MS.length} retries`
      );
    }
    const text = await response.text();
    if (!response.ok()) {
      throw new Error(`${label} → ${response.status()}: ${text.slice(0, 300)}`);
    }
    return text === "" ? null : JSON.parse(text);
  }

  private async parse<TSchema extends z.ZodType>(
    response: APIResponse,
    schema: TSchema,
    label: string
  ): Promise<z.infer<TSchema>> {
    const body = await this.readBody(response, label);
    const result = schema.safeParse(unwrapData(body));

    if (!result.success) {
      throw new Error(
        `${label} → unexpected response: ${z.prettifyError(result.error)}`
      );
    }

    return result.data;
  }
}
