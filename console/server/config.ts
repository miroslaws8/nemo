import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { z } from "zod";
import { envSetting } from "../../engine/environment";
import { E2E_ROOT } from "../../engine/paths";
import { CONSOLE_MODES } from "../shared/api";
import { readUsersFile } from "./auth/users";
import { DEV_PORT, RUNNER_KINDS } from "./settings";
import type {
  IConsoleMode,
  IConsoleSettings,
  IFilesSettings,
  IGitSettings,
  ILoginSettings,
  ISkillRegistrySettings,
} from "./types";

// How this console runs, from QA_CONSOLE_* settings (the environment, else myqa's .env):
//   local  — a developer's machine: loopback only, nobody signs in, tests from this working tree;
//   server — the team's console at QA_CONSOLE_PUBLIC_URL: people sign in with their account
//            of the app (QA_CONSOLE_IDP_URL, _IDP_API_URL, _OAUTH_CLIENT_ID) and get the role the
//            users file (QA_CONSOLE_USERS_FILE) gives them; each run tests a commit of myqa
//            (QA_CONSOLE_GIT_URL, with QA_CONSOLE_GIT_TOKEN for a private https repository).
// A server image runs branch code as users of its own (QA_CONSOLE_RUNNERS=sudo, runners.ts).
// Either mode may serve run files (reports, traces, screenshots: written by branch code) from
// another origin, QA_CONSOLE_FILES_URL, so their scripts never run on the console's own.
// A console that is set up wrong does not start: it lists what to fix.

const KEYS = [
  "QA_CONSOLE_MODE",
  "QA_CONSOLE_HOST",
  "QA_CONSOLE_PORT",
  "QA_CONSOLE_PUBLIC_URL",
  "QA_CONSOLE_DATA_DIR",
  "QA_CONSOLE_MAX_ACTIVE_RUNS",
  "QA_CONSOLE_KEEP_RUNS",
  "QA_CONSOLE_IDP_URL",
  "QA_CONSOLE_IDP_API_URL",
  "QA_CONSOLE_OAUTH_CLIENT_ID",
  "QA_CONSOLE_USERS_FILE",
  "QA_CONSOLE_GIT_URL",
  "QA_CONSOLE_GIT_TOKEN",
  "QA_CONSOLE_BUILD",
  "QA_CONSOLE_INGEST_TOKENS",
  "QA_CONSOLE_FILES_URL",
  "QA_CONSOLE_RUNNERS",
  "QA_CONSOLE_HERMES",
  "QA_CONSOLE_ANTHROPIC_API_KEY",
  "QA_CONSOLE_OPENAI_API_KEY",
  "QA_CONSOLE_AGENT_DAILY_USD",
  "QA_CONSOLE_SKILLS_BUCKET",
  "QA_CONSOLE_SKILLS_ENDPOINT",
  "QA_CONSOLE_SKILLS_REGION",
  "QA_CONSOLE_SKILLS_PREFIX",
  "QA_CONSOLE_SKILLS_PATH_STYLE",
  "QA_CONSOLE_SKILLS_ACCESS_KEY_ID",
  "QA_CONSOLE_SKILLS_SECRET_ACCESS_KEY",
] as const;

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set([
  "127.0.0.1",
  "::1",
  "[::1]",
  "localhost",
]);

const webUrl = z.url({ protocol: /^https?$/ });

const settingsSchema = z.object({
  QA_CONSOLE_MODE: z.enum(CONSOLE_MODES).default("local"),
  QA_CONSOLE_HOST: z.string().min(1).optional(),
  QA_CONSOLE_PORT: z.coerce.number().int().min(1).max(65535).default(7357),
  QA_CONSOLE_PUBLIC_URL: webUrl.optional(),
  QA_CONSOLE_DATA_DIR: z.string().min(1).optional(),
  QA_CONSOLE_MAX_ACTIVE_RUNS: z.coerce.number().int().min(1).max(8).default(2),
  QA_CONSOLE_KEEP_RUNS: z.coerce.number().int().min(1).max(1000).default(30),
  QA_CONSOLE_IDP_URL: webUrl.optional(),
  QA_CONSOLE_IDP_API_URL: webUrl.optional(),
  QA_CONSOLE_OAUTH_CLIENT_ID: z.string().min(1).optional(),
  QA_CONSOLE_USERS_FILE: z.string().min(1).optional(),
  QA_CONSOLE_GIT_URL: z.string().min(1).optional(),
  QA_CONSOLE_GIT_TOKEN: z.string().min(1).optional(),
  // The image's tag (its build sets it); "local" for a console run from a working tree.
  QA_CONSOLE_BUILD: z.string().min(1).default("local"),
  QA_CONSOLE_FILES_URL: webUrl.optional(),
  QA_CONSOLE_RUNNERS: z.enum(RUNNER_KINDS).default("self"),
  // Agent checks: the hermes command (the image's /usr/local/bin/qa-hermes) and the models' keys.
  QA_CONSOLE_HERMES: z.string().min(1).default("hermes"),
  QA_CONSOLE_ANTHROPIC_API_KEY: z
    .string()
    .min(20, "an Anthropic API key is longer")
    .optional(),
  QA_CONSOLE_OPENAI_API_KEY: z
    .string()
    .min(20, "an OpenAI API key is longer")
    .optional(),
  // The S3 bucket skills live in (AWS S3 or any S3-compatible store): none, and they stay where the
  // mode keeps them. DigitalOcean Spaces signs with any region; MinIO wants path-style addresses.
  QA_CONSOLE_SKILLS_BUCKET: z
    .string()
    .regex(
      /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/,
      "a bucket name: 3-63 lowercase letters, digits, dots and hyphens"
    )
    .optional(),
  QA_CONSOLE_SKILLS_ENDPOINT: webUrl.default("https://s3.amazonaws.com"),
  QA_CONSOLE_SKILLS_REGION: z.string().min(1).default("us-east-1"),
  QA_CONSOLE_SKILLS_PREFIX: z
    .string()
    .regex(
      /^([a-z0-9][a-z0-9._-]*\/)*$/,
      "folders, each ending in /, e.g. test/"
    )
    .default(""),
  QA_CONSOLE_SKILLS_PATH_STYLE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  QA_CONSOLE_SKILLS_ACCESS_KEY_ID: z.string().min(8).optional(),
  QA_CONSOLE_SKILLS_SECRET_ACCESS_KEY: z.string().min(8).optional(),
  // What agent checks may spend in a day (UTC), estimated at list prices, in dollars.
  QA_CONSOLE_AGENT_DAILY_USD: z.coerce.number().positive().default(5),
  // Tokens CI sends its runs with (ci/ingest.mts), comma-separated: two while one is replaced.
  QA_CONSOLE_INGEST_TOKENS: z
    .string()
    .transform((value) =>
      value
        .split(",")
        .map((token) => token.trim())
        .filter((token) => token !== "")
    )
    .pipe(
      z
        .array(z.string().min(24, "an ingest token has at least 24 characters"))
        .max(2)
    )
    .optional(),
});

type ISettingValues = z.infer<typeof settingsSchema>;

/** What a mode makes of the settings: where people open it and how they sign in. */
interface IModeSetup {
  // Empty: it may start; otherwise the rest is not used.
  problems: string[];
  publicUrl: string;
  login: ILoginSettings | null;
  git: IGitSettings | null;
}

interface IModeRules {
  host: string;
  dataDir: string;
  // Whether it offers environments only a developer's machine reaches (local_only).
  localOnlyEnvironments: boolean;
  setup: (values: ISettingValues, host: string, port: number) => IModeSetup;
}

/** The console cannot start as set up; `problems` says what to fix. */
export class ConsoleSetupError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join("\n"));
  }
}

function isLoopback(host: string): boolean {
  return (
    LOOPBACK_HOSTS.has(host) || (net.isIPv4(host) && host.startsWith("127."))
  );
}

function withoutTrailingSlash(url: string): string {
  return url.replace(/\/$/, "");
}

function loopbackHosts(port: number): string[] {
  return [port, DEV_PORT].flatMap((allowedPort) => [
    `127.0.0.1:${allowedPort}`,
    `localhost:${allowedPort}`,
  ]);
}

// Cookies and sign-in tokens travel over https, except to this very machine.
function plainHttpProblems(urls: Record<string, string>): string[] {
  return Object.entries(urls).flatMap(([key, url]) => {
    const parsed = new URL(url);
    return parsed.protocol === "http:" && !isLoopback(parsed.hostname)
      ? [
          `${key}=${url}: use https (plain http only for 127.0.0.1 or localhost)`,
        ]
      : [];
  });
}

function usersFileProblems(file: string): string[] {
  try {
    readUsersFile(file);
    return [];
  } catch (error) {
    return [
      `QA_CONSOLE_USERS_FILE: ${
        error instanceof Error ? error.message : String(error)
      }`,
    ];
  }
}

// A token goes to an https repository only.
function gitTokenProblems(url: string, token: string | undefined): string[] {
  return token !== undefined && !url.startsWith("https://")
    ? [
        `QA_CONSOLE_GIT_TOKEN is set, so QA_CONSOLE_GIT_URL=${url} must be https`,
      ]
    : [];
}

const SERVER_KEYS = [
  "QA_CONSOLE_PUBLIC_URL",
  "QA_CONSOLE_IDP_URL",
  "QA_CONSOLE_IDP_API_URL",
  "QA_CONSOLE_OAUTH_CLIENT_ID",
  "QA_CONSOLE_USERS_FILE",
  "QA_CONSOLE_GIT_URL",
] as const;

function failed(problems: string[]): IModeSetup {
  return { problems, publicUrl: "", login: null, git: null };
}

// The team's console: its address and how people sign in, all required.
function serverSetup(values: ISettingValues): IModeSetup {
  const {
    QA_CONSOLE_PUBLIC_URL: publicSetting,
    QA_CONSOLE_IDP_URL: idpUrl,
    QA_CONSOLE_IDP_API_URL: idpApiUrl,
    QA_CONSOLE_OAUTH_CLIENT_ID: clientId,
    QA_CONSOLE_USERS_FILE: usersFile,
    QA_CONSOLE_GIT_URL: gitUrl,
    QA_CONSOLE_GIT_TOKEN: gitToken,
  } = values;
  if (
    publicSetting === undefined ||
    idpUrl === undefined ||
    idpApiUrl === undefined ||
    clientId === undefined ||
    usersFile === undefined ||
    gitUrl === undefined
  ) {
    const missing = SERVER_KEYS.filter((key) => values[key] === undefined);
    return failed([
      `server mode needs ${missing.join(
        ", "
      )} (docs/guide.md → Console settings)`,
    ]);
  }
  const problems = [
    ...plainHttpProblems({
      QA_CONSOLE_PUBLIC_URL: publicSetting,
      QA_CONSOLE_IDP_URL: idpUrl,
      QA_CONSOLE_IDP_API_URL: idpApiUrl,
    }),
    ...usersFileProblems(usersFile),
    ...gitTokenProblems(gitUrl, gitToken),
  ];
  if (problems.length > 0) {
    return failed(problems);
  }
  const publicUrl = withoutTrailingSlash(publicSetting);
  return {
    problems: [],
    publicUrl,
    login: {
      idpUrl: withoutTrailingSlash(idpUrl),
      idpApiUrl: withoutTrailingSlash(idpApiUrl),
      clientId,
      redirectUri: `${publicUrl}/auth/callback`,
      usersFile: path.resolve(usersFile),
      secureCookies: new URL(publicUrl).protocol === "https:",
    },
    git: { url: gitUrl, token: gitToken ?? null },
  };
}

// What each mode means when a setting is left out, and what it needs.
const MODES: Record<IConsoleMode, IModeRules> = {
  local: {
    host: "127.0.0.1",
    dataDir: path.join(E2E_ROOT, "reports"),
    localOnlyEnvironments: true,
    // Nobody signs in, so nothing but this machine may reach it; its tests are its own code.
    setup: (values, host, port) => ({
      problems: [
        ...(isLoopback(host)
          ? []
          : [
              `QA_CONSOLE_HOST=${host}: local mode serves this machine only (127.0.0.1); the team's console is QA_CONSOLE_MODE=server`,
            ]),
        ...(values.QA_CONSOLE_RUNNERS === "sudo"
          ? [
              "QA_CONSOLE_RUNNERS=sudo is for a server console (its image has the runner users)",
            ]
          : []),
      ],
      publicUrl: `http://127.0.0.1:${port}`,
      login: null,
      git: null,
    }),
  },
  server: {
    host: "0.0.0.0",
    dataDir: "/data",
    localOnlyEnvironments: false,
    setup: (values) => serverSetup(values),
  },
};

// Run files on an origin of their own: just an origin, not the console's, https off this machine.
function filesSetup(
  filesSetting: string | undefined,
  publicUrl: string
): { problems: string[]; files: IFilesSettings | null } {
  if (filesSetting === undefined) {
    return { problems: [], files: null };
  }
  const files = new URL(filesSetting);
  const problems = [
    ...(files.pathname !== "/" || files.search !== "" || files.hash !== ""
      ? [
          `QA_CONSOLE_FILES_URL=${filesSetting}: an origin only (https://host[:port]), no path`,
        ]
      : []),
    ...(publicUrl !== "" && files.origin === new URL(publicUrl).origin
      ? [
          `QA_CONSOLE_FILES_URL=${filesSetting}: another origin than the console's own (QA_CONSOLE_PUBLIC_URL)`,
        ]
      : []),
    ...plainHttpProblems({ QA_CONSOLE_FILES_URL: filesSetting }),
  ];
  return {
    problems,
    files: problems.length > 0 ? null : { url: files.origin, host: files.host },
  };
}

// The bucket skills live in: all of it, or none of it, its keys only over https (or a loopback host).
function skillRegistrySetup(values: ISettingValues): {
  problems: string[];
  registry: ISkillRegistrySettings | null;
} {
  const bucket = values.QA_CONSOLE_SKILLS_BUCKET;
  const accessKeyId = values.QA_CONSOLE_SKILLS_ACCESS_KEY_ID;
  const secretAccessKey = values.QA_CONSOLE_SKILLS_SECRET_ACCESS_KEY;
  if (bucket === undefined) {
    return {
      problems:
        accessKeyId === undefined && secretAccessKey === undefined
          ? []
          : [
              "QA_CONSOLE_SKILLS_ACCESS_KEY_ID / _SECRET_ACCESS_KEY: set QA_CONSOLE_SKILLS_BUCKET too, or neither",
            ],
      registry: null,
    };
  }
  if (accessKeyId === undefined || secretAccessKey === undefined) {
    return {
      problems: [
        `QA_CONSOLE_SKILLS_BUCKET=${bucket}: it needs QA_CONSOLE_SKILLS_ACCESS_KEY_ID and QA_CONSOLE_SKILLS_SECRET_ACCESS_KEY`,
      ],
      registry: null,
    };
  }
  const problems = plainHttpProblems({
    QA_CONSOLE_SKILLS_ENDPOINT: values.QA_CONSOLE_SKILLS_ENDPOINT,
  });
  return {
    problems,
    registry:
      problems.length > 0
        ? null
        : {
            bucket,
            endpoint: values.QA_CONSOLE_SKILLS_ENDPOINT,
            region: values.QA_CONSOLE_SKILLS_REGION,
            prefix: values.QA_CONSOLE_SKILLS_PREFIX,
            pathStyle: values.QA_CONSOLE_SKILLS_PATH_STYLE,
            accessKeyId,
            secretAccessKey,
          },
  };
}

function dataDirProblems(runsDir: string): string[] {
  try {
    fs.mkdirSync(runsDir, { recursive: true });
    fs.accessSync(runsDir, fs.constants.W_OK);
    return [];
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return [
      `QA_CONSOLE_DATA_DIR: ${path.dirname(
        runsDir
      )} cannot be written (${reason})`,
    ];
  }
}

function readSettings(): IConsoleSettings {
  const parsed = settingsSchema.safeParse(
    Object.fromEntries(KEYS.map((key) => [key, envSetting(key) ?? undefined]))
  );
  if (!parsed.success) {
    throw new ConsoleSetupError(
      parsed.error.issues.map(
        (issue) => `${issue.path.join(".")}: ${issue.message}`
      )
    );
  }
  const values = parsed.data;
  const mode = values.QA_CONSOLE_MODE;
  const rules = MODES[mode];
  const host = values.QA_CONSOLE_HOST ?? rules.host;
  const port = values.QA_CONSOLE_PORT;
  const dataDir = path.resolve(values.QA_CONSOLE_DATA_DIR ?? rules.dataDir);
  const runsDir = path.join(dataDir, "runs");
  const setup = rules.setup(values, host, port);
  const { problems: filesProblems, files } = filesSetup(
    values.QA_CONSOLE_FILES_URL,
    setup.publicUrl
  );
  const { problems: registryProblems, registry } = skillRegistrySetup(values);

  const problems = [
    ...setup.problems,
    ...filesProblems,
    ...registryProblems,
    ...dataDirProblems(runsDir),
  ];
  if (problems.length > 0) {
    throw new ConsoleSetupError(problems);
  }

  const publicOrigin = new URL(setup.publicUrl);
  // The files origin is a Host the console answers (with run files only), never an Origin it
  // takes changes from.
  const loopback = (isLoopback(host) ? loopbackHosts(port) : []).filter(
    (allowed) => allowed !== files?.host
  );
  return {
    mode,
    host,
    port,
    publicUrl: setup.publicUrl,
    allowedHosts: new Set([
      publicOrigin.host,
      ...loopback,
      ...(files === null ? [] : [files.host]),
    ]),
    allowedOrigins: new Set([
      publicOrigin.origin,
      ...loopback.map((allowed) => `http://${allowed}`),
    ]),
    files,
    runners: values.QA_CONSOLE_RUNNERS,
    agents: {
      hermes: values.QA_CONSOLE_HERMES,
      apiKeys: {
        anthropic: values.QA_CONSOLE_ANTHROPIC_API_KEY ?? null,
        openai: values.QA_CONSOLE_OPENAI_API_KEY ?? null,
      },
      dailyUsd: values.QA_CONSOLE_AGENT_DAILY_USD,
    },
    localOnlyEnvironments: rules.localOnlyEnvironments,
    dataDir,
    runsDir,
    stateDir: path.join(dataDir, "state"),
    maxActiveRuns: values.QA_CONSOLE_MAX_ACTIVE_RUNS,
    keepRuns: values.QA_CONSOLE_KEEP_RUNS,
    build: values.QA_CONSOLE_BUILD,
    ingestTokens: values.QA_CONSOLE_INGEST_TOKENS ?? [],
    login: setup.login,
    git: setup.git,
    skillRegistry: registry,
  };
}

let loaded: IConsoleSettings | null = null;

/** The settings, read once; a ConsoleSetupError lists what to fix. */
export function consoleSettings(): IConsoleSettings {
  loaded ??= readSettings();
  return loaded;
}
