import type { IRateLimitHit } from "./types";

// The app's API allows each user a fixed number of requests a minute and answers 429 past it. Every test boots the app afresh
// (~15-20 API calls), so a test run reaches the limit where a person never would: the engine waits
// it out instead of failing on it.

export const TOO_MANY_REQUESTS = 429;

// The limit counts per minute, so no pause needs to be longer.
const MAX_PAUSE_MS = 60_000;

const MAX_LISTED_REQUESTS = 3;

function retryAfterMs(headers: Record<string, string>): number {
  const seconds = Number(headers["retry-after"]);
  return Number.isFinite(seconds) ? seconds * 1000 : 0;
}

// X-RateLimit-Reset is an epoch second of the API's clock, so it is measured against the response's
// own Date header rather than the local clock.
function untilResetMs(headers: Record<string, string>): number {
  const resetSeconds = Number(headers["x-ratelimit-reset"]);
  const serverNowMs = Date.parse(headers["date"] ?? "");
  if (!Number.isFinite(resetSeconds) || Number.isNaN(serverNowMs)) {
    return 0;
  }
  return resetSeconds * 1000 - serverNowMs;
}

function clampPause(pauseMs: number, floorMs: number): number {
  return Math.min(Math.max(pauseMs, floorMs), MAX_PAUSE_MS);
}

/** The pause a 429 response asks for (Retry-After, X-RateLimit-Reset): at least `floorMs`, at most a minute. */
export function rateLimitPauseMs(
  headers: Record<string, string>,
  floorMs: number
): number {
  return clampPause(
    Math.max(retryAfterMs(headers), untilResetMs(headers)),
    floorMs
  );
}

/** The pause until the limit behind every hit has reset: at least `floorMs`, at most a minute. */
export function pauseForHits(
  hits: readonly IRateLimitHit[],
  floorMs: number
): number {
  const latestRetryAt = Math.max(...hits.map((hit) => hit.retryAt));
  return clampPause(latestRetryAt - Date.now(), floorMs);
}

export function describeRateLimitHits(hits: readonly IRateLimitHit[]): string {
  const requests = [...new Set(hits.map((hit) => hit.request))];
  const listed = requests.slice(0, MAX_LISTED_REQUESTS).join(", ");
  const unlisted = requests.length - MAX_LISTED_REQUESTS;
  const more = unlisted > 0 ? ` and ${unlisted} more` : "";
  return `${hits.length}× 429 on ${listed}${more}`;
}

/**
 * Adds to a failure that the API refused some of the page's requests: the page may have shown a
 * wrong state because of the run's pace, not because of an app bug.
 */
export function withRateLimitNote(
  error: unknown,
  hits: readonly IRateLimitHit[]
): unknown {
  if (hits.length === 0 || !(error instanceof Error)) {
    return error;
  }
  const note = `\n\nThe API rate limit refused requests of the page (${describeRateLimitHits(
    hits
  )}), which likely caused this failure.`;
  error.message += note;
  // Reporters print the message from the stack, so the note goes there too, before the frames.
  if (error.stack !== undefined) {
    const framesStart = error.stack.search(/\n\s+at /);
    error.stack =
      framesStart === -1
        ? error.stack + note
        : error.stack.slice(0, framesStart) +
          note +
          error.stack.slice(framesStart);
  }
  return error;
}

export function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}
