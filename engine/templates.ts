import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { callArguments, normalizeSteps } from "./normalize";
import { E2E_ROOT } from "./paths";
import { REPEAT_KEYWORD, templateFileSchema } from "./schema";
import { STEPS_BY_KEYWORD } from "./steps";
import { paramValueSchema } from "./template-params";
import type {
  IParsedTemplateFile,
  IStepNode,
  ITemplateDefinition,
  ITemplateParam,
  ITemplateSignature,
  IVariables,
} from "./types";
import { readYamlDocument } from "./yaml-document";

const TEMPLATES_DIRECTORY = path.join(E2E_ROOT, "templates");
const TEMPLATE_FILE_PATTERN = /\.template\.ya?ml$/;
const MAX_CALL_DEPTH = 8;

function findTemplateFiles(): string[] {
  if (!fs.existsSync(TEMPLATES_DIRECTORY)) {
    return [];
  }
  return fs
    .readdirSync(TEMPLATES_DIRECTORY, { recursive: true, encoding: "utf8" })
    .filter((entry) => TEMPLATE_FILE_PATTERN.test(entry))
    .sort()
    .map((entry) => path.join(TEMPLATES_DIRECTORY, entry));
}

function buildParams(
  params: z.infer<typeof templateFileSchema>["params"],
  file: string
): ITemplateParam[] {
  return Object.entries(params).map(([name, settings]) => {
    if (settings.default !== undefined) {
      const validation = paramValueSchema(settings.type).safeParse(
        settings.default
      );
      if (!validation.success) {
        throw new Error(
          `${file}: the default of param "${name}" is not a ${settings.type}`
        );
      }
    }
    return {
      name,
      type: settings.type,
      required: settings.default === undefined,
      defaultValue: settings.default ?? null,
      description: settings.description ?? null,
    };
  });
}

function parseTemplateFile(filePath: string): IParsedTemplateFile {
  const file = path.relative(E2E_ROOT, filePath);
  const document = readYamlDocument(filePath, file);
  const parsed = templateFileSchema.safeParse(document.data);
  if (!parsed.success) {
    throw new Error(`${file}: ${z.prettifyError(parsed.error)}`);
  }

  return {
    signature: {
      name: parsed.data.template,
      file,
      title: parsed.data.title ?? null,
      description: parsed.data.description ?? null,
      params: buildParams(parsed.data.params, file),
    },
    document,
    rawSteps: parsed.data.steps,
  };
}

// A template becomes a step keyword, so its name must be unique and not shadow a built-in step.
function registerSignatures(
  files: IParsedTemplateFile[]
): Map<string, ITemplateSignature> {
  const signatures = new Map<string, ITemplateSignature>();
  for (const { signature } of files) {
    if (
      STEPS_BY_KEYWORD.has(signature.name) ||
      signature.name === REPEAT_KEYWORD
    ) {
      throw new Error(
        `${signature.file}: "${signature.name}" is already a built-in step`
      );
    }
    const existing = signatures.get(signature.name);
    if (existing !== undefined) {
      throw new Error(
        `${signature.file}: template "${signature.name}" is already defined in ${existing.file}`
      );
    }
    signatures.set(signature.name, signature);
  }
  return signatures;
}

function calledTemplates(steps: IStepNode[]): string[] {
  return steps.flatMap((step) => {
    switch (step.kind) {
      case "template":
        return [step.template];
      case "repeat":
        return calledTemplates(step.steps);
      case "action":
        return [];
      default: {
        const unknownStep: never = step;
        return [String(unknownStep)];
      }
    }
  });
}

function findCallCycle(
  templates: ReadonlyMap<string, ITemplateDefinition>,
  name: string,
  trail: string[]
): string[] | null {
  if (trail.includes(name)) {
    return [...trail, name];
  }
  if (trail.length >= MAX_CALL_DEPTH) {
    throw new Error(
      `templates nest deeper than ${MAX_CALL_DEPTH}: ${[...trail, name].join(
        " → "
      )}`
    );
  }

  const template = templates.get(name);
  for (const called of template === undefined
    ? []
    : calledTemplates(template.steps)) {
    const cycle = findCallCycle(templates, called, [...trail, name]);
    if (cycle !== null) {
      return cycle;
    }
  }
  return null;
}

let cachedTemplates: ReadonlyMap<string, ITemplateDefinition> | null = null;

/** Reads every templates/**\/*.template.yaml once; a broken template fails the run with its location. */
export function loadTemplates(): ReadonlyMap<string, ITemplateDefinition> {
  if (cachedTemplates !== null) {
    return cachedTemplates;
  }

  const files = findTemplateFiles().map(parseTemplateFile);
  const signatures = registerSignatures(files);
  const templates = new Map<string, ITemplateDefinition>(
    files.map(({ signature, document, rawSteps }) => [
      signature.name,
      {
        ...signature,
        steps: normalizeSteps(rawSteps, ["steps"], {
          file: signature.file,
          document,
          templates: signatures,
          declaredParams: new Set(signature.params.map((param) => param.name)),
        }),
      },
    ])
  );

  for (const template of templates.values()) {
    const cycle = findCallCycle(templates, template.name, []);
    if (cycle !== null) {
      throw new Error(
        `${template.file}: templates call each other in a loop: ${cycle.join(
          " → "
        )}`
      );
    }
  }

  cachedTemplates = templates;
  return cachedTemplates;
}

export function getTemplate(name: string): ITemplateDefinition {
  const template = loadTemplates().get(name);
  if (template === undefined) {
    throw new Error(`Unknown template "${name}"`);
  }
  return template;
}

/** The params of one call, once its ${placeholders} are resolved: defaults filled in, types checked. */
export function resolveTemplateParams(
  template: ITemplateDefinition,
  args: unknown
): IVariables {
  const provided = callArguments(args) ?? {};
  const params: IVariables = {};

  for (const param of template.params) {
    const value =
      param.name in provided ? provided[param.name] : param.defaultValue;
    const validation = paramValueSchema(param.type).safeParse(value);
    if (!validation.success) {
      throw new Error(
        `${template.name}: param "${param.name}" — ${z.prettifyError(
          validation.error
        )}`
      );
    }
    params[param.name] = validation.data;
  }
  return params;
}
