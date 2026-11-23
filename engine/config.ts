import fs from "node:fs";
import path from "node:path";
import { devices } from "@playwright/test";
import { parse } from "yaml";
import { z } from "zod";
import {
  aiSettingsSchema,
  aiSwitchSchema,
  checkAiReferences,
} from "./ai/settings-schema";
import { CONFIG_PATH, TESTS_DIRECTORY } from "./paths";
import { durationSchema } from "./schema";
import type { IE2eConfig } from "./types";

/** The versions of a stored skill an environment runs (skill_channel). */
export const SKILL_CHANNELS = ["latest", "prod"] as const;

const nameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/, "use lowercase letters, digits and dashes");

const environmentSettingsSchema = z.strictObject({
  base_url: z.url(),
  api_url: z.url().optional(),
  // The QA account (QA_<NAME>_EMAIL / _PASSWORD). Left out: the tests run signed out (a public
  // site), with no login, no setups and no data of their own.
  credentials: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]*$/, "the <NAME> in QA_<NAME>_EMAIL, e.g. STAGE")
    .refine(
      (name) => !`${name}_`.startsWith("CONSOLE_"),
      "CONSOLE is taken: QA_CONSOLE_* are the QA console's settings"
    )
    .optional(),
  // A Playwright device the tests run as (its screen, user agent and touch), e.g. "Pixel 7".
  device: z
    .string()
    .refine(
      (name) => Object.hasOwn(devices, name),
      'not a Playwright device name, e.g. "Pixel 7" or "iPhone 15" (playwright.dev/docs/emulation)'
    )
    .optional(),
  // A folder under tests/ that holds this environment's tests, e.g. "demo". Left out: every test
  // except those in a folder another environment names here.
  tests: z
    .string()
    .regex(
      /^[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9_-]*)*$/,
      "a folder under tests/, e.g. demo"
    )
    .optional(),
  // The cookie of the signed-in session that holds the API's Bearer token, for an app whose API
  // takes one; left out, API calls send the session's cookies only.
  api_token_cookie: z.string().min(1).optional(),
  // How the login project signs in (engine/auth.setup.ts): the page that shows (or redirects to)
  // the sign-in form and the name of its submit button. The fields are the form's email and
  // password inputs.
  login: z
    .strictObject({
      path: z
        .string()
        .regex(/^\//, "a path from base_url, e.g. /login")
        .default("/"),
      submit: z.string().min(1).optional(),
      // The path the app lands on once signed in, e.g. /dashboard; left out: anywhere on the
      // app past the form. Set it when the app finishes signing in after a redirect of its own
      // (an OAuth callback), or the session is saved before the app has stored it.
      done: z
        .string()
        .regex(/^\//, "a path from base_url, e.g. /dashboard")
        .optional(),
    })
    .optional(),
  allowed_tiers: z.array(nameSchema).min(1).optional(),
  // `ai: false`: no AI here, whatever the `ai` section says.
  ai: aiSwitchSchema,
  // Runs write real data with the shared QA account: tools ask for an explicit confirmation.
  guarded: z.boolean().default(false),
  // The git branch the QA console's server runs this environment's tests from.
  branch: z.string().min(1).default("develop"),
  // Reachable only from a developer's machine (the app on localhost): the server QA console
  // neither offers nor runs it.
  local_only: z.boolean().default(false),
  // The origin of its sign-in page (the IdP): where the QA console's agent checks fill the QA
  // account's password from Hermes's vault.
  login_origin: z.url().optional(),
  // Which version of a skill kept in the QA console's skill store its agent checks run: the
  // newest ("latest"), or the one an operator promoted to prod ("prod").
  skill_channel: z.enum(SKILL_CHANNELS).default("latest"),
  // The Hermes skills (hermes/skills) CI has the QA console run here after a deploy and on its
  // schedule (ci/ingest.mts agents).
  agent_checks: z
    .array(z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "a skill's folder name"))
    .default([]),
});

const tierSettingsSchema = z.strictObject({
  description: z.string().optional(),
  workers: z.number().int().min(1).default(1),
  retries: z.number().int().min(0).max(3).default(0),
  needs: z.array(nameSchema).default([]),
  read_only: z.boolean().default(false),
});

const profileSettingsSchema = z.strictObject({
  description: z.string().optional(),
  tiers: z.array(nameSchema).min(1),
  global_timeout: durationSchema.optional(),
  // `ai: false`: no AI in this profile's runs (e.g. a monitor), whatever the `ai` section says.
  ai: aiSwitchSchema,
});

const safetySettingsSchema = z.strictObject({
  data_prefix: z.string().min(1),
  protected_titles: z.array(z.string().min(1)).default([]),
});

const cleanupPolicySchema = z.enum(["delete", "keep"]);

const cleanupSettingsSchema = z.strictObject({
  on_pass: cleanupPolicySchema,
  on_fail: cleanupPolicySchema,
  // A run stopped by hand (Ctrl+C, the console's Stop) is not a failure worth keeping data for.
  on_interrupt: cleanupPolicySchema.default("delete"),
});

const sweeperSettingsSchema = z.strictObject({
  older_than: durationSchema,
  max_deletes: z.number().int().min(1),
});

const errorMonitorSettingsSchema = z.strictObject({
  // Check for errors at the end of every test, not only where a test says expect_no_errors.
  auto_check: z.boolean(),
  // Regular expressions for known, harmless records, e.g. "^401 GET /api/notifications".
  ignore: z
    .array(
      z.string().refine((source) => {
        try {
          new RegExp(source);
          return true;
        } catch {
          return false;
        }
      }, "not a valid regular expression")
    )
    .default([]),
});

const configShapeSchema = z.strictObject({
  environments: z.record(nameSchema, environmentSettingsSchema),
  tiers: z.record(nameSchema, tierSettingsSchema),
  profiles: z.record(nameSchema, profileSettingsSchema),
  default_profile: nameSchema,
  safety: safetySettingsSchema,
  cleanup: cleanupSettingsSchema,
  sweeper: sweeperSettingsSchema,
  error_monitor: errorMonitorSettingsSchema,
  // The models AI features use, by role (engine/ai/, docs/guide.md → AI). None: AI is off.
  ai: aiSettingsSchema.optional(),
});

type IConfigShape = z.infer<typeof configShapeSchema>;

function findNeedsCycle(
  config: IConfigShape,
  tierName: string,
  trail: string[]
): string[] | null {
  if (trail.includes(tierName)) {
    return [...trail, tierName];
  }
  for (const need of config.tiers[tierName]?.needs ?? []) {
    const cycle = findNeedsCycle(config, need, [...trail, tierName]);
    if (cycle !== null) {
      return cycle;
    }
  }
  return null;
}

// Names used across sections must exist, so a typo fails here instead of silently running nothing.
function checkReferences(config: IConfigShape, context: z.RefinementCtx): void {
  const tierNames = Object.keys(config.tiers);
  const report = (issuePath: PropertyKey[], message: string): void => {
    context.addIssue({ code: "custom", path: issuePath, message });
  };
  const reportUnknownTiers = (
    issuePath: PropertyKey[],
    names: string[]
  ): void => {
    for (const name of names.filter((tier) => !tierNames.includes(tier))) {
      report(
        issuePath,
        `unknown tier "${name}" — tiers: ${tierNames.join(", ")}`
      );
    }
  };

  if (config.profiles[config.default_profile] === undefined) {
    report(["default_profile"], `no profile "${config.default_profile}"`);
  }
  for (const [tierName, tier] of Object.entries(config.tiers)) {
    reportUnknownTiers(["tiers", tierName, "needs"], tier.needs);
    const cycle = findNeedsCycle(config, tierName, []);
    if (cycle !== null) {
      report(["tiers", tierName, "needs"], `cycle: ${cycle.join(" → ")}`);
    }
  }
  for (const [profileName, profile] of Object.entries(config.profiles)) {
    reportUnknownTiers(["profiles", profileName, "tiers"], profile.tiers);
    for (const tierName of profile.tiers) {
      const missing = (config.tiers[tierName]?.needs ?? []).filter(
        (need) => !profile.tiers.includes(need)
      );
      for (const need of missing) {
        report(
          ["profiles", profileName, "tiers"],
          `tier "${tierName}" needs "${need}" — add it to the profile`
        );
      }
    }
  }
  if (config.ai !== undefined) {
    checkAiReferences(config.ai, report);
  }
  for (const [environmentName, environment] of Object.entries(
    config.environments
  )) {
    reportUnknownTiers(
      ["environments", environmentName, "allowed_tiers"],
      environment.allowed_tiers ?? []
    );
    if (
      environment.tests !== undefined &&
      !fs.existsSync(path.join(TESTS_DIRECTORY, environment.tests))
    ) {
      report(
        ["environments", environmentName, "tests"],
        `tests/${environment.tests} does not exist`
      );
    }
  }
}

export const e2eConfigSchema = configShapeSchema.superRefine(checkReferences);

let cachedConfig: IE2eConfig | null = null;

/** Reads e2e.config.yaml once per process; an invalid file stops the run with its location. */
export function loadE2eConfig(): IE2eConfig {
  if (cachedConfig !== null) {
    return cachedConfig;
  }
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`${CONFIG_PATH} is missing`);
  }

  const parsed = e2eConfigSchema.safeParse(
    parse(fs.readFileSync(CONFIG_PATH, "utf8"))
  );
  if (!parsed.success) {
    throw new Error(`e2e.config.yaml: ${z.prettifyError(parsed.error)}`);
  }

  cachedConfig = parsed.data;
  return cachedConfig;
}
