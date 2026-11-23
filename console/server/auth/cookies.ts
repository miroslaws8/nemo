import type { IncomingMessage } from "node:http";

// The console's cookies: HttpOnly and SameSite=Lax, Secure when it is served over https.

export interface ICookieSpec {
  name: string;
  path: string;
  secure: boolean;
}

export function readCookie(
  request: IncomingMessage,
  name: string
): string | null {
  for (const part of (request.headers.cookie ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator !== -1 && part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }
  return null;
}

/** A Set-Cookie value (the value is base64url: nothing to encode). */
export function setCookie(
  spec: ICookieSpec,
  value: string,
  maxAgeMs: number
): string {
  return [
    `${spec.name}=${value}`,
    `Path=${spec.path}`,
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(spec.secure ? ["Secure"] : []),
  ].join("; ");
}

export function clearCookie(spec: ICookieSpec): string {
  return setCookie(spec, "", 0);
}
