import type { IncomingMessage } from "node:http";
import type { IActor, IRequestState } from "../types";

// What the request middleware learnt about each request (who sends it, at which address), for the
// guard, the parameter decorators, the exception filter and the audit. Kept beside the request,
// not on it: nothing to type onto Express's request, nothing to clean up.

const NOBODY: IActor = { email: null, role: null, session: null };
const STATES = new WeakMap<IncomingMessage, IRequestState>();

export function setRequestState(
  request: IncomingMessage,
  state: IRequestState
): void {
  STATES.set(request, state);
}

/** The request's state; a request the middleware never reached counts as nobody's. */
export function requestState(request: IncomingMessage): IRequestState {
  let state = STATES.get(request);
  if (state === undefined) {
    state = { actor: NOBODY, pathname: "", onFilesOrigin: false, error: null };
    STATES.set(request, state);
  }
  return state;
}
