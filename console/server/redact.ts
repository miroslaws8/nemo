// Session tokens show up in logs and error messages; the console never hands them on.

const SECRETS = [
  /Bearer\s+[A-Za-z0-9._~+/=-]+/g,
  /idp_access_token=[^;\s"']+/g,
];

export function redact(text: string): string {
  return SECRETS.reduce(
    (result, pattern) => result.replace(pattern, "[redacted]"),
    text
  );
}
