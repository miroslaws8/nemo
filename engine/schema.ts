import type { Page } from "@playwright/test";
import { z } from "zod";
import type { IDuration, ILocatorKey } from "./types";

type AriaRole = Parameters<Page["getByRole"]>[0];

export const ARIA_ROLES = [
  "alert",
  "alertdialog",
  "article",
  "banner",
  "button",
  "cell",
  "checkbox",
  "columnheader",
  "combobox",
  "complementary",
  "contentinfo",
  "dialog",
  "form",
  "grid",
  "gridcell",
  "group",
  "heading",
  "img",
  "link",
  "list",
  "listbox",
  "listitem",
  "main",
  "menu",
  "menubar",
  "menuitem",
  "navigation",
  "option",
  "progressbar",
  "radio",
  "radiogroup",
  "region",
  "row",
  "rowheader",
  "searchbox",
  "slider",
  "spinbutton",
  "status",
  "switch",
  "tab",
  "table",
  "tablist",
  "tabpanel",
  "textbox",
  "toolbar",
  "tooltip",
  "tree",
  "treeitem",
] as const satisfies readonly AriaRole[];

const DURATION_PATTERN = /^(\d+)(ms|s|m|h|d)$/;

const DURATION_UNITS_MS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

export const durationSchema = z.union([
  z.number().int().positive(),
  z
    .string()
    .regex(DURATION_PATTERN, "use a duration like 500ms, 30s, 20m, 1h or 1d"),
]);

export function parseDuration(
  value: IDuration | undefined,
  fallbackMs: number
): number {
  if (value === undefined) {
    return fallbackMs;
  }
  if (typeof value === "number") {
    return value;
  }

  const match = value.match(DURATION_PATTERN);
  if (!match) {
    throw new Error(`Invalid duration "${value}"`);
  }

  return Number(match[1]) * DURATION_UNITS_MS[match[2]];
}

export const LOCATOR_KEYS = [
  "button",
  "role",
  "text",
  "css",
  "placeholder",
  "label",
  "testid",
] as const;

/** Shared by every step that points at an element; steps add their own fields on top. */
export const TARGET_SHAPE = {
  button: z.string().min(1).optional(),
  role: z.enum(ARIA_ROLES).optional(),
  name: z.string().min(1).optional(),
  text: z.string().min(1).optional(),
  css: z.string().min(1).optional(),
  placeholder: z.string().min(1).optional(),
  label: z.string().min(1).optional(),
  testid: z.string().min(1).optional(),
  in: z.enum(ARIA_ROLES).optional(),
  exact: z.boolean().optional(),
  // Keep only the matches that contain (or do not contain) this text, e.g. a row by its title.
  has_text: z.string().min(1).optional(),
  has_not_text: z.string().min(1).optional(),
  nth: z.number().int().min(0).optional(),
};

export const SINGLE_LOCATOR_MESSAGE = `a target needs exactly one of: ${LOCATOR_KEYS.join(
  ", "
)}`;

export function hasSingleLocator(
  target: Partial<Record<ILocatorKey, unknown>>
): boolean {
  return LOCATOR_KEYS.filter((key) => target[key] !== undefined).length === 1;
}

export const targetSchema = z
  .strictObject(TARGET_SHAPE)
  .refine(hasSingleLocator, SINGLE_LOCATOR_MESSAGE);

export const STEP_MODIFIERS_SHAPE = {
  name: z.string().min(1).optional(),
  when: z.string().min(1).optional(),
  unless: z.string().min(1).optional(),
};

export const STEP_MODIFIER_KEYS: ReadonlySet<string> = new Set(
  Object.keys(STEP_MODIFIERS_SHAPE)
);

export const stepModifiersSchema = z.strictObject(STEP_MODIFIERS_SHAPE);

const recordSchema = z.record(z.string(), z.unknown());

/** Inside a template, `${params.x}` and `when: params.x` read its parameters. */
export const PARAMS_VARIABLE = "params";

/** Variables every test gets (env, run, test) plus template params; rows and setups may not reuse them. */
export const RESERVED_VARIABLES: readonly string[] = [
  "env",
  "run",
  "test",
  PARAMS_VARIABLE,
];

export const variableNameSchema = z
  .string()
  .regex(/^[a-z_][a-z0-9_]*$/i, "use letters, digits and underscores")
  .refine(
    (name) => !RESERVED_VARIABLES.includes(name),
    `reserved names: ${RESERVED_VARIABLES.join(", ")}`
  );

export const eachSchema = z
  .strictObject({
    as: variableNameSchema,
    from: z.string().min(1).optional(),
    items: z.array(recordSchema).min(1).optional(),
  })
  .refine(
    (each) => (each.from === undefined) !== (each.items === undefined),
    'each needs exactly one of "from" or "items"'
  );

/** The block step: `repeat: { until: <target>, max, steps: [...] }`. */
export const REPEAT_KEYWORD = "repeat";

export const repeatArgsSchema = z.strictObject({
  until: recordSchema,
  max: z.number().int().min(1).max(100).default(25),
  steps: z.array(recordSchema).min(1),
});

export const TEMPLATE_PARAM_TYPES = [
  "string",
  "number",
  "boolean",
  "duration",
] as const;

const SNAKE_CASE_NAME = /^[a-z][a-z0-9_]*$/;

const templateParamSchema = z.strictObject({
  type: z.enum(TEMPLATE_PARAM_TYPES),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  description: z.string().min(1).optional(),
});

export const templateFileSchema = z.strictObject({
  template: z
    .string()
    .regex(SNAKE_CASE_NAME, "use snake_case: it becomes a step keyword"),
  // The report title of a call; may use ${params.x}.
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  params: z
    .record(
      z.string().regex(SNAKE_CASE_NAME, "use snake_case parameter names"),
      templateParamSchema
    )
    .default({}),
  steps: z.array(recordSchema).min(1),
});

export const testSchema = z.strictObject({
  name: z.string().min(1),
  timeout: durationSchema.optional(),
  skip: z.boolean().optional(),
  only: z.boolean().optional(),
  steps: z.array(recordSchema).min(1),
});

export const testFileSchema = z.strictObject({
  suite: z.string().min(1),
  // One of the tiers in e2e.config.yaml; it decides which runs (profiles) include the file.
  tier: z.string().min(1),
  tags: z
    .array(
      z
        .string()
        .regex(/^[a-z0-9-]+$/, "tags are lowercase words joined by dashes")
    )
    .default([]),
  // A setup name, or { name: { ...params } } to pass params (e.g. { order: { as: other_order } }).
  setup: z.array(z.union([z.string().min(1), recordSchema])).default([]),
  each: eachSchema.optional(),
  tests: z.array(testSchema).min(1),
});

export const rowsSchema = z.array(recordSchema).min(1);
