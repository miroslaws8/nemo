import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadE2eConfig } from "./config";
import { E2E_ROOT } from "./paths";
import type { ICredentials, IEnvironment, IVariables } from "./types";

// A bare run targets staging, so prod is only ever reached with an explicit E2E_ENV=prod.
export const DEFAULT_ENVIRONMENT = "staging";

const ENV_FILES = [
  path.join(E2E_ROOT, ".env"),
  path.join(os.homedir(), ".hermes", ".env"),
];

// The QA console's own settings share the QA_ prefix with the tests' variables.
export const CONSOLE_SETTING_PREFIX = "QA_CONSOLE_";

const ENV_LINE = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/;

function readEnvFile(file: string): Map<string, string> {
  const values = new Map<string, string>();
  if (!fs.existsSync(file)) {
    return values;
  }
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const match = line.match(ENV_LINE);
    if (match) {
      values.set(match[1], match[2].replace(/^["']|["']$/g, ""));
    }
  }
  return values;
}

// Only QA_* keys reach the tests (never the console's QA_CONSOLE_* settings), and a variable
// already set in the real environment wins.
function isTestVariable(key: string): boolean {
  return key.startsWith("QA_") && !key.startsWith(CONSOLE_SETTING_PREFIX);
}

function loadEnvFiles(): void {
  for (const file of ENV_FILES) {
    for (const [key, value] of readEnvFile(file)) {
      if (isTestVariable(key) && process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}

loadEnvFiles();

/**
 * A setting of the tools around the tests (e.g. the console's Bitbucket token): from the
 * environment, else the first .env file that has it. It is never handed to the tests.
 */
export function envSetting(key: string): string | null {
  const fromEnvironment = process.env[key];
  if (fromEnvironment !== undefined && fromEnvironment !== "") {
    return fromEnvironment;
  }
  for (const file of ENV_FILES) {
    const value = readEnvFile(file).get(key);
    if (value !== undefined && value !== "") {
      return value;
    }
  }
  return null;
}

function withoutTrailingSlash(url: string): string {
  return url.replace(/\/$/, "");
}

export function selectedEnvironmentName(): string {
  return (process.env.E2E_ENV ?? DEFAULT_ENVIRONMENT).toLowerCase();
}

/** An environment from e2e.config.yaml; QA_<NAME>_URL / _ALIAS / _API override it. */
export function buildEnvironment(name: string): IEnvironment {
  const config = loadE2eConfig();
  const settings = config.environments[name];
  if (settings === undefined) {
    const known = Object.keys(config.environments).join(", ");
    throw new Error(
      `Unknown environment "${name}" — e2e.config.yaml defines: ${known}`
    );
  }

  // Without an account, the environment's name still prefixes its overrides (QA_DEMO_URL).
  const prefix =
    settings.credentials ?? name.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const baseUrl = withoutTrailingSlash(
    process.env[`QA_${prefix}_URL`] ?? settings.base_url
  );
  const apiUrl = process.env[`QA_${prefix}_API`] ?? settings.api_url;
  // E2E_AUTH_DIR: a folder the sessions are kept in elsewhere (the server console shares one).
  const authDirectory =
    process.env.E2E_AUTH_DIR?.trim() || path.join(E2E_ROOT, ".auth");

  return {
    name,
    baseUrl,
    envPrefix: prefix,
    alias:
      process.env[`QA_${prefix}_ALIAS`] ??
      settings.alias ??
      new URL(baseUrl).hostname.split(".")[0],
    apiUrl: apiUrl === undefined ? null : withoutTrailingSlash(apiUrl),
    allowedTiers: settings.allowed_tiers ?? null,
    signsIn: settings.credentials !== undefined,
    device: settings.device ?? null,
    testsFolder: settings.tests ?? null,
    guarded: settings.guarded,
    branch: settings.branch,
    localOnly: settings.local_only,
    skillChannel: settings.skill_channel,
    loginOrigin:
      settings.login_origin === undefined
        ? null
        : new URL(settings.login_origin).origin,
    storageStatePath: path.join(authDirectory, `${name}.json`),
    sessionMetaPath: path.join(authDirectory, `${name}.meta.json`),
  };
}

/** The environment of this run: E2E_ENV, default staging. */
export function getEnvironment(): IEnvironment {
  return buildEnvironment(selectedEnvironmentName());
}

/** Exposed to YAML as ${env.name} and ${env.base_url}. */
export function environmentVariables(environment: IEnvironment): IVariables {
  return { name: environment.name, base_url: environment.baseUrl };
}

export function getCredentials(environment: IEnvironment): ICredentials {
  const emailVariable = `QA_${environment.envPrefix}_EMAIL`;
  const passwordVariable = `QA_${environment.envPrefix}_PASSWORD`;
  const email = process.env[emailVariable];
  const password = process.env[passwordVariable];

  if (!email || !password) {
    throw new Error(
      `Missing ${emailVariable} / ${passwordVariable} — set them in the environment, .env or ~/.hermes/.env`
    );
  }

  return { email, password };
}
