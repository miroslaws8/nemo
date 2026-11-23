import { z } from "zod";
import {
  BITBUCKET_API,
  BITBUCKET_TOKEN_KEY,
  CI_HOURLY_BUDGET,
} from "../settings";

// Bitbucket Cloud's REST API as the console uses it: the repository's pipelines, read with a
// repository access token (Bearer). It counts its own requests to stay under the hourly budget,
// and when Bitbucket answers 429 it asks nothing until the time Bitbucket gave.

const HOUR_MS = 3_600_000;
const DEFAULT_PAUSE_MS = 60_000;
// Requests kept back for what people do (stop, rerun) when polling has used the budget.
const ACTIONS_RESERVE = 50;

export type IBitbucketPurpose = "poll" | "action";

export class BitbucketError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

// What Bitbucket's answers look like, as far as the console reads them.
const stateSchema = z.object({
  name: z.string(),
  result: z.object({ name: z.string() }).optional(),
  stage: z.object({ name: z.string() }).optional(),
});

export const bitbucketPipelineSchema = z.object({
  uuid: z.string(),
  build_number: z.number().int(),
  creator: z.object({ display_name: z.string().optional() }).nullish(),
  target: z
    .object({
      ref_name: z.string().optional(),
      selector: z
        .object({ type: z.string().optional(), pattern: z.string().optional() })
        .optional(),
    })
    .optional(),
  trigger: z
    .object({ name: z.string().optional(), type: z.string().optional() })
    .optional(),
  state: stateSchema,
  variables: z
    .array(
      z.object({
        key: z.string(),
        value: z.string().optional(),
        secured: z.boolean().optional(),
      })
    )
    .optional(),
  created_on: z.string(),
  completed_on: z.string().nullish(),
});

export const bitbucketStepSchema = z.object({
  uuid: z.string(),
  name: z.string().optional(),
  state: stateSchema,
  started_on: z.string().nullish(),
  completed_on: z.string().nullish(),
});

export const bitbucketReportSchema = z.object({
  number_of_test_cases: z.number().int().optional(),
  number_of_successful_test_cases: z.number().int().optional(),
  number_of_failed_test_cases: z.number().int().optional(),
  number_of_error_test_cases: z.number().int().optional(),
  number_of_skipped_test_cases: z.number().int().optional(),
});

export const bitbucketTestCaseSchema = z.object({
  uuid: z.string(),
  name: z.string().optional(),
  fully_qualified_name: z.string().optional(),
  package_name: z.string().optional(),
  status: z.string().optional(),
});

// Bitbucket does not document a reason's fields; its text ones are what the console shows.
export const bitbucketReasonSchema = z.record(z.string(), z.unknown());

export function pageOf<TItem extends z.ZodType>(
  item: TItem
): z.ZodObject<{ values: z.ZodArray<TItem> }> {
  return z.object({ values: z.array(item) });
}

export type IBitbucketPipeline = z.infer<typeof bitbucketPipelineSchema>;
export type IBitbucketStep = z.infer<typeof bitbucketStepSchema>;

const MESSAGES: ReadonlyMap<number, string> = new Map([
  [
    401,
    `Bitbucket refused the token: check ${BITBUCKET_TOKEN_KEY} in .env (a repository access token with Pipelines: Read and Write)`,
  ],
  [
    403,
    "The token may not do this: it needs Pipelines: Read and Write on the repository",
  ],
]);

function retryAfterMs(response: Response): number {
  const seconds = Number(response.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0
    ? seconds * 1000
    : DEFAULT_PAUSE_MS;
}

export class BitbucketApi {
  private readonly sent: number[] = [];
  private pausedUntilMs = 0;
  private readonly base: string;

  /** `repository`: <workspace>/<repository>. */
  constructor(
    private readonly token: string,
    private readonly repository: string
  ) {
    this.base = `${BITBUCKET_API}/repositories/${repository}`;
  }

  /** A pipeline's page on bitbucket.org. */
  pipelinePage(number: number): string {
    return `https://bitbucket.org/${this.repository}/pipelines/results/${number}`;
  }

  /** While Bitbucket's rate limit holds the console back. */
  pausedUntil(): string | null {
    return this.pausedUntilMs > Date.now()
      ? new Date(this.pausedUntilMs).toISOString()
      : null;
  }

  /** A request of the repository (`path` after /repositories/{workspace}/{repo}). */
  async send(
    path: string,
    purpose: IBitbucketPurpose,
    init: {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
    } = {}
  ): Promise<Response> {
    this.checkAllowed(purpose);
    this.sent.push(Date.now());
    let response: Response;
    try {
      response = await fetch(`${this.base}${path}`, {
        method: init.method ?? "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.token}`,
          ...init.headers,
        },
        body: init.body,
      });
    } catch {
      throw new BitbucketError(502, "Bitbucket did not answer");
    }
    if (response.status === 429) {
      this.pausedUntilMs = Date.now() + retryAfterMs(response);
      throw new BitbucketError(
        429,
        `Bitbucket's rate limit: the console asks again after ${new Date(
          this.pausedUntilMs
        ).toLocaleTimeString("en-GB")}`
      );
    }
    return response;
  }

  /** A JSON answer checked against `schema`; any status but 2xx is a BitbucketError. */
  async json<TSchema extends z.ZodType>(
    path: string,
    schema: TSchema,
    purpose: IBitbucketPurpose,
    init: { method?: string; body?: unknown } = {}
  ): Promise<z.infer<TSchema>> {
    const response = await this.send(path, purpose, {
      method: init.method,
      headers:
        init.body === undefined ? {} : { "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    if (!response.ok) {
      throw await this.failure(response);
    }
    const parsed = schema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) {
      throw new BitbucketError(
        502,
        `Bitbucket answered ${path.split("?")[0]} in an unexpected shape`
      );
    }
    return parsed.data;
  }

  async failure(response: Response): Promise<BitbucketError> {
    const known = MESSAGES.get(response.status);
    if (known !== undefined) {
      return new BitbucketError(response.status, known);
    }
    const text = (await response.text().catch(() => "")).slice(0, 300);
    return new BitbucketError(
      response.status,
      `Bitbucket answered ${response.status}${text === "" ? "" : `: ${text}`}`
    );
  }

  private checkAllowed(purpose: IBitbucketPurpose): void {
    const paused = this.pausedUntil();
    if (paused !== null) {
      throw new BitbucketError(
        429,
        `Bitbucket's rate limit: the console asks again after ${new Date(
          paused
        ).toLocaleTimeString("en-GB")}`
      );
    }
    const hourAgo = Date.now() - HOUR_MS;
    while (this.sent.length > 0 && (this.sent[0] ?? 0) < hourAgo) {
      this.sent.shift();
    }
    const limit =
      purpose === "poll"
        ? CI_HOURLY_BUDGET - ACTIONS_RESERVE
        : CI_HOURLY_BUDGET;
    if (this.sent.length >= limit) {
      throw new BitbucketError(
        429,
        `The console has used its Bitbucket budget for this hour (${this.sent.length} requests); CI updates resume within the hour`
      );
    }
  }
}
