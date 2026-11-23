import path from "node:path";
import { z } from "zod";
import { e2eConfigSchema, loadE2eConfig } from "./config";
import { E2E_ROOT } from "./paths";
import {
  durationSchema,
  REPEAT_KEYWORD,
  repeatArgsSchema,
  STEP_MODIFIERS_SHAPE,
  targetSchema,
  templateFileSchema,
  testFileSchema,
  testSchema,
} from "./schema";
import { SETUPS } from "./setups";
import { skillFileSchema, skillTemplateFileSchema } from "./skill-schema";
import { STEPS } from "./steps";
import { loadTemplates } from "./templates";
import type {
  IJsonSchemaFile,
  ITemplateParamType,
  ITemplateSignature,
} from "./types";

const SCHEMA_DIRECTORY = path.join(E2E_ROOT, "schema");

const PLACEHOLDER_ONLY = z.string().regex(/^\$\{[^}]+\}$/, "a ${variable}");

// In the editor a non-string param may also be a ${variable}; its type is checked at run time.
const EDITOR_PARAM_SCHEMAS: Record<ITemplateParamType, z.ZodType> = {
  string: z.string(),
  number: z.union([z.number(), PLACEHOLDER_ONLY]),
  boolean: z.union([z.boolean(), PLACEHOLDER_ONLY]),
  duration: z.union([durationSchema, PLACEHOLDER_ONLY]),
};

function toJsonText(schema: z.ZodType): string {
  const jsonSchema = z.toJSONSchema(schema, {
    io: "input",
    target: "draft-7",
    unrepresentable: "any",
  });
  return `${JSON.stringify(jsonSchema, null, 2)}\n`;
}

function editorCallArguments(template: ITemplateSignature): z.ZodType {
  const shape = Object.fromEntries(
    template.params.map((param) => {
      const valueSchema = EDITOR_PARAM_SCHEMAS[param.type];
      const described =
        param.description === null
          ? valueSchema
          : valueSchema.describe(param.description);
      return [param.name, param.required ? described : described.optional()];
    })
  );
  const argumentsSchema = z.strictObject(shape);

  // A template without required params can be called bare: `- open_dashboard:`.
  if (template.params.some((param) => param.required)) {
    return argumentsSchema;
  }
  return z.union([argumentsSchema, z.null()]);
}

// Every built-in step, every template call (each with its own arguments) and the repeat block,
// whose own steps are again any of these.
function buildEditorStepSchema(): z.ZodType {
  const actionSteps: z.ZodType[] = STEPS.map((step) =>
    z.strictObject({ [step.keyword]: step.schema, ...STEP_MODIFIERS_SHAPE })
  );
  const templateCalls: z.ZodType[] = [...loadTemplates().values()].map(
    (template) => {
      const call = z.strictObject({
        [template.name]: editorCallArguments(template),
        ...STEP_MODIFIERS_SHAPE,
      });
      return template.description === null
        ? call
        : call.describe(template.description);
    }
  );
  const stepSchema: z.ZodType = z.lazy(() => {
    const [firstStep, ...otherSteps] = [
      ...actionSteps,
      ...templateCalls,
      repeatBlock,
    ];
    return z.union([firstStep, ...otherSteps]);
  });
  const repeatBlock = z.strictObject({
    [REPEAT_KEYWORD]: repeatArgsSchema.extend({
      until: targetSchema,
      steps: z.array(stepSchema).min(1),
    }),
    ...STEP_MODIFIERS_SHAPE,
  });
  return stepSchema;
}

// A setup entry: a bare name, or { name: { ...params } }.
function buildEditorSetupSchema(): z.ZodType {
  const withParams: z.ZodType[] = SETUPS.map((setup) =>
    z.strictObject({ [setup.name]: z.union([setup.params, z.null()]) })
  );
  return z.union([z.literal(SETUPS.map((setup) => setup.name)), ...withParams]);
}

// The editor variant of a test file: steps and template calls with their arguments, the setups
// with their params, and the tiers from e2e.config.yaml as the allowed `tier` values.
function buildEditorTestFileSchema(stepSchema: z.ZodType): z.ZodType {
  return testFileSchema.extend({
    tier: z.literal(Object.keys(loadE2eConfig().tiers)),
    setup: z.array(buildEditorSetupSchema()).optional(),
    tests: z
      .array(testSchema.extend({ steps: z.array(stepSchema).min(1) }))
      .min(1),
  });
}

function buildEditorTemplateFileSchema(stepSchema: z.ZodType): z.ZodType {
  return templateFileSchema.extend({
    steps: z.array(stepSchema).min(1),
  });
}

/** The JSON Schemas behind YAML autocompletion; `pnpm schema` writes them, validate compares. */
export function buildJsonSchemaFiles(): IJsonSchemaFile[] {
  const stepSchema = buildEditorStepSchema();
  return [
    {
      path: path.join(SCHEMA_DIRECTORY, "test-file.schema.json"),
      content: toJsonText(buildEditorTestFileSchema(stepSchema)),
    },
    {
      path: path.join(SCHEMA_DIRECTORY, "template-file.schema.json"),
      content: toJsonText(buildEditorTemplateFileSchema(stepSchema)),
    },
    {
      path: path.join(SCHEMA_DIRECTORY, "config.schema.json"),
      content: toJsonText(e2eConfigSchema),
    },
    {
      path: path.join(SCHEMA_DIRECTORY, "skill-file.schema.json"),
      content: toJsonText(skillFileSchema),
    },
    {
      path: path.join(SCHEMA_DIRECTORY, "skill-template.schema.json"),
      content: toJsonText(skillTemplateFileSchema),
    },
  ];
}
