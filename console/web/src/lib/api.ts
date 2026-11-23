import { apiErrorSchema } from "@shared/api";
import type { z } from "zod";

// Talks to the console server (same origin). Every answer is checked against its schema from
// console/shared/api.ts; a failed request becomes an ApiError with the server's own message. A 401
// (the session is gone) also tells state/session.ts, which signs the browser in again.

const UNREACHABLE = "The console does not answer. Is it still running?";

let sessionLost: (() => void) | null = null;

/** Who hears of a 401: state/session.ts. */
export function onSessionLost(handler: () => void): void {
  sessionLost = handler;
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function send(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(path, init);
  } catch {
    throw new ApiError(0, UNREACHABLE);
  }
}

async function readAnswer<TSchema extends z.ZodType>(
  response: Response,
  schema: TSchema
): Promise<z.infer<TSchema>> {
  const body: unknown = await response.json().catch(() => null);
  if (response.status === 401) {
    sessionLost?.();
  }
  if (!response.ok) {
    const failure = apiErrorSchema.safeParse(body);
    throw new ApiError(
      response.status,
      failure.success
        ? failure.data.error
        : `${response.status} ${response.statusText}`
    );
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(
      response.status,
      `Unexpected answer from ${new URL(response.url).pathname}`
    );
  }
  return parsed.data;
}

export async function getJson<TSchema extends z.ZodType>(
  path: string,
  schema: TSchema
): Promise<z.infer<TSchema>> {
  const response = await send(path, {
    headers: { accept: "application/json" },
  });
  return readAnswer(response, schema);
}

export async function postJson<TSchema extends z.ZodType>(
  path: string,
  body: unknown,
  schema: TSchema
): Promise<z.infer<TSchema>> {
  const response = await send(path, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return readAnswer(response, schema);
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
