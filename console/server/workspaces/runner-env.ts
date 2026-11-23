import { buildEnvironment } from "../../../engine/environment";

// What a server console hands the code of a branch: the system basics and the credentials of the
// run's environment, never its own settings (sign-in, git and Bitbucket tokens) or another
// environment's account. The credentials prefix comes from the console's e2e.config.yaml, not the
// branch's. (Whoever may push to nemo runs code on the server: this narrows what that code is
// handed; it is not a sandbox.)

const PASSED: readonly string[] = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "TMPDIR",
  "PLAYWRIGHT_BROWSERS_PATH",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
];

function picked(keep: (key: string) => boolean): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) => value !== undefined && keep(key)
    )
  );
}

/** The basics only: for git, tar and pnpm. */
export function toolEnvironment(): NodeJS.ProcessEnv {
  return { ...picked((key) => PASSED.includes(key)), GIT_TERMINAL_PROMPT: "0" };
}

/** The basics and one environment's QA_<prefix>_* (its QA account), plus `variables`. */
export function runnerEnvironment(
  env: string,
  variables: Record<string, string>
): NodeJS.ProcessEnv {
  const prefix = `QA_${buildEnvironment(env).envPrefix}_`;
  return {
    ...picked((key) => PASSED.includes(key) || key.startsWith(prefix)),
    ...variables,
  };
}
