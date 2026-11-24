import { z } from "zod";

// The `ai` section of e2e.config.yaml as written (snake_case). engine/ai/settings.ts turns it into
// IAiSettings for one environment and profile. Kept apart from settings.ts so that engine/config.ts
// can use it without importing what reads the config.

/** How the engine talks to a model: a strategy each (engine/ai/protocols/). */
export const AI_PROTOCOLS = ["openai", "anthropic"] as const;

const roleNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_-]*$/, "use lowercase letters, digits, - and _");

const modelSchema = z.strictObject({
  protocol: z.enum(AI_PROTOCOLS),
  model: z.string().min(1),
  // Another server of the protocol: OpenRouter, Ollama (http://localhost:11434/v1), vLLM, ….
  base_url: z
    .url()
    .refine((url) => {
      const parsed = new URL(url);
      return parsed.username === "" && parsed.password === "";
    }, "no credentials in base_url: the key goes in `key`")
    .optional(),
  // The variable holding its API key, a QA_* name (the engine's .env loading reaches those);
  // null for a server that takes none.
  key: z
    .string()
    .regex(
      /^QA_(?!CONSOLE_)[A-Z0-9_]+$/,
      "a QA_* variable that is not a QA_CONSOLE_* setting, e.g. QA_AI_OPENAI_KEY"
    )
    .nullable(),
  // It reads images: the judge sends screenshots.
  vision: z.boolean().default(false),
  // More fields for the request body, as the provider names them, e.g. { reasoning_effort: none }
  // (OpenAI's reasoning models take tools only so). How one model differs, without code.
  params: z.record(z.string(), z.unknown()).default({}),
  // List prices, for the run's budget.
  usd_per_million: z.strictObject({
    input: z.number().min(0),
    output: z.number().min(0),
  }),
});

const judgeSchema = z.strictObject({
  model: roleNameSchema,
  escalate_to: roleNameSchema.optional(),
  // Below this, an answer counts as unsure and the page is checked again.
  min_confidence: z.number().min(0).max(1).default(0.7),
  // Checks again with the same model before escalating.
  retries: z.number().int().min(0).max(3).default(2),
  // A confident "fail" fails the step (an ai_check may say otherwise for itself).
  blocking: z.boolean().default(true),
});

/** Words whose button or link the test author never clicks (docs/guide.md → Writing a test with AI). */
export const DEFAULT_AUTHOR_AVOID = [
  "pay",
  "buy",
  "checkout",
  "purchase",
  "publish",
  "delete",
  "remove",
  "sign out",
  "log out",
  "unsubscribe",
];

const authorSchema = z.strictObject({
  // A role with tool calling and vision.
  model: roleNameSchema,
  max_actions: z.number().int().min(5).max(100).default(30),
  avoid: z.array(z.string().min(1)).default(DEFAULT_AUTHOR_AVOID),
});

export const aiSettingsSchema = z.strictObject({
  models: z.record(roleNameSchema, modelSchema),
  judge: judgeSchema,
  // pnpm author: the model that walks a described case and writes its test.
  author: authorSchema.optional(),
  budget_usd_per_run: z.number().positive().default(2),
});

/** An environment or a profile switches AI off with `ai: false`. */
export const aiSwitchSchema = z.literal(false).optional();

export type IAiSection = z.infer<typeof aiSettingsSchema>;

/** The judge's roles must exist and read images; reported at their place in the file. */
export function checkAiReferences(
  ai: IAiSection,
  report: (issuePath: PropertyKey[], message: string) => void
): void {
  const roles = Object.keys(ai.models);
  const used: [string[], string | undefined][] = [
    [["judge", "model"], ai.judge.model],
    [["judge", "escalate_to"], ai.judge.escalate_to],
    [["author", "model"], ai.author?.model],
  ];
  for (const [field, role] of used) {
    if (role === undefined) {
      continue;
    }
    const model = ai.models[role];
    if (model === undefined) {
      report(
        ["ai", ...field],
        `no model "${role}" in ai.models — models: ${roles.join(", ")}`
      );
    } else if (!model.vision) {
      report(
        ["ai", ...field],
        `"${role}" is not marked vision: true; it is sent screenshots`
      );
    }
  }
}
