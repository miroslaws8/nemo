import fs from "node:fs";
import {
  request,
  type APIRequestContext,
  type APIResponse,
  type BrowserContext,
} from "@playwright/test";
import { z } from "zod";
import { instanceSchema } from "./api-schemas";
import { rateLimitPauseMs, sleep, TOO_MANY_REQUESTS } from "./rate-limit";
import type { IEnvironment, IInstance, INotify, IPage } from "./types";

const storageStateSchema = z.object({
  cookies: z.array(z.object({ name: z.string(), value: z.string() })),
});

const sessionMetaSchema = z.object({ apiOrigin: z.string().url() });

const pageMetaSchema = z.object({
  meta: z.object({ last_page: z.coerce.number().int().min(1) }),
});

const ACCESS_TOKEN_COOKIE = "idp_access_token";
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

function unwrapData(body: unknown): unknown {
  if (typeof body === "object" && body !== null && "data" in body) {
    return body.data;
  }
  return body;
}

function findAccessToken(cookies: { name: string; value: string }[]): string {
  const tokenCookie = cookies.find(
    (cookie) => cookie.name === ACCESS_TOKEN_COOKIE
  );
  if (!tokenCookie) {
    throw new Error(`No ${ACCESS_TOKEN_COOKIE} cookie in the session`);
  }
  return decodeURIComponent(tokenCookie.value);
}

/** Talks to the app's API (a separate host from the app) as the logged-in test user. */
export class ApiClient {
  private instance: IInstance | null = null;

  private constructor(
    private readonly context: APIRequestContext,
    private readonly environment: IEnvironment,
    private readonly savedToken: string,
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
    const storageState = storageStateSchema.parse(
      readJsonFile(environment.storageStatePath)
    );
    const session = sessionMetaSchema.parse(
      readJsonFile(environment.sessionMetaPath)
    );
    const origin = environment.apiUrl ?? session.apiOrigin;

    // The app sends the IDP token as a Bearer header; cookies alone get a 401.
    const context = await request.newContext({
      baseURL: origin,
      storageState: environment.storageStatePath,
      extraHTTPHeaders: {
        Accept: "application/json",
        Origin: environment.baseUrl,
        Referer: `${environment.baseUrl}/`,
      },
    });

    return new ApiClient(
      context,
      environment,
      findAccessToken(storageState.cookies),
      browserContext,
      origin,
      notify
    );
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

  /** One page of a Laravel paginated list: its items and the number of the last page. */
  async getPage<TItem extends z.ZodType>(
    apiPath: string,
    itemSchema: TItem,
    page: number
  ): Promise<IPage<z.infer<TItem>>> {
    const separator = apiPath.includes("?") ? "&" : "?";
    const pagePath = `${apiPath}${separator}page=${page}`;
    const label = `GET ${pagePath}`;
    const response = await this.send(label, (headers) =>
      this.context.get(pagePath, { headers })
    );
    const body = await this.readBody(response, label);
    const meta = pageMetaSchema.safeParse(body);
    const items = z.array(itemSchema).safeParse(unwrapData(body));
    if (!meta.success || !items.success) {
      throw new Error(
        `GET ${pagePath} → not a paginated list of the expected items`
      );
    }
    return { items: items.data, lastPage: meta.data.meta.last_page };
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

  async resolveInstance(): Promise<IInstance> {
    if (this.instance) {
      return this.instance;
    }

    const instance = await this.get(
      `/api/instances/alias/${this.environment.alias}`,
      instanceSchema
    );
    const workspaceId = instance.workspace_id ?? instance.workspace?.id;

    if (workspaceId === undefined) {
      throw new Error(
        `Instance "${this.environment.alias}" has no workspace — set QA_${this.environment.envPrefix}_ALIAS if the alias is wrong`
      );
    }

    this.instance = { instanceId: instance.id, workspaceId };
    return this.instance;
  }

  /** The instance alias, for the /api/instances/alias/:alias/… routes. */
  get alias(): string {
    return this.environment.alias;
  }

  async dispose(): Promise<void> {
    await this.context.dispose();
  }

  private async authorization(): Promise<Record<string, string>> {
    const token =
      this.browserContext === null
        ? this.savedToken
        : findAccessToken(await this.browserContext.cookies());
    return { Authorization: `Bearer ${token}` };
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
