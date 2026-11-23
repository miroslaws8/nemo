import { meSchema, SIGN_IN_PROBLEMS, signedOutSchema } from "@shared/api";
import type { IMe } from "@shared/types";
import { computed, ref } from "vue";
import { ApiError, getJson, onSessionLost, postJson } from "@/lib/api";
import type { IModeWords, ISessionState, ISignInNotice } from "@/types";

// Who uses this tab (GET /api/me). A server console signs people in with their app account:
// without a session the tab goes to /auth/login and comes back where it was. A local one has
// nobody to sign in: its user may do anything.

const RETRY_MS = 3000;
// A sign-in that comes back without a session within this long would only go round again.
const ROUND_TRIP_MS = 60_000;
const SIGN_IN_STARTED = "qa-console:sign-in-started";

const NOTICES: readonly ISignInNotice[] = [
  ...SIGN_IN_PROBLEMS,
  "signed-out",
  "stuck",
];

const MODE_WORDS: Record<IMe["mode"], IModeWords> = {
  local: {
    runsTab: "This Mac",
    runsNav: "Runs on this Mac",
    newRun: "Runs on this Mac, logged in as the environment's QA account.",
    home: "Tests run on this Mac against each environment",
  },
  server: {
    runsTab: "Console",
    runsNav: "Runs on the console",
    newRun:
      "Runs on the console's server, logged in as the environment's QA account.",
    home: "Tests run on the console's server against each environment",
  },
};

export const me = ref<IMe | null>(null);
export const sessionState = ref<ISessionState>("checking");
/** What the sign-in page says when the app shows it (a lost session, no access). */
export const signInNotice = ref<ISignInNotice | null>(null);

export const modeWords = computed(() => MODE_WORDS[me.value?.mode ?? "local"]);

/** A ?problem= value of /sign-in, if it is one the page knows. */
export function parseNotice(value: unknown): ISignInNotice | null {
  return NOTICES.find((notice) => notice === value) ?? null;
}

function remember(key: string, value: string | null): void {
  try {
    if (value === null) {
      sessionStorage.removeItem(key);
    } else {
      sessionStorage.setItem(key, value);
    }
  } catch {
    // No session storage (a private window): the round-trip guard just does not apply.
  }
}

function recalled(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Off to the IdP, and back to `returnTo` (this page by default). */
export function signIn(returnTo: string = window.location.href): void {
  remember(SIGN_IN_STARTED, String(Date.now()));
  window.location.assign(
    `/auth/login?returnTo=${encodeURIComponent(returnTo)}`
  );
}

function showSignIn(notice: ISignInNotice | null): void {
  me.value = null;
  signInNotice.value = notice;
  sessionState.value = "signed-out";
}

// The server said the session is gone (401): sign in again, unless a sign-in just came back
// without one (the browser did not keep the cookie): then say so instead of going round.
function sessionLost(): void {
  if (sessionState.value === "signed-out") {
    return;
  }
  const started = Number(recalled(SIGN_IN_STARTED) ?? 0);
  if (Date.now() - started < ROUND_TRIP_MS) {
    remember(SIGN_IN_STARTED, null);
    showSignIn("stuck");
    return;
  }
  sessionState.value = "checking";
  signIn();
}

onSessionLost(sessionLost);

/** Finds out who uses this tab; until the console answers, it keeps asking. */
export async function loadMe(): Promise<void> {
  try {
    me.value = await getJson("/api/me", meSchema);
    remember(SIGN_IN_STARTED, null);
    sessionState.value = "signed-in";
  } catch (failure) {
    if (!(failure instanceof ApiError)) {
      throw failure;
    }
    if (failure.status === 403) {
      showSignIn("not-listed");
    } else if (failure.status !== 401) {
      setTimeout(() => void loadMe(), RETRY_MS);
    }
  }
}

/** Asks again whether the session is still there (the event stream was refused). */
export function checkSession(): void {
  getJson("/api/me", meSchema).catch(() => undefined);
}

/** Ends this browser's session; the page that follows does not sign in again by itself. */
export async function signOut(): Promise<void> {
  await postJson("/auth/logout", {}, signedOutSchema).catch(() => undefined);
  window.location.assign("/sign-in?problem=signed-out");
}
