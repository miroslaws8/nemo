import { z } from "zod";
import {
  PARAMS_VARIABLE,
  REPEAT_KEYWORD,
  repeatArgsSchema,
  STEP_MODIFIER_KEYS,
  stepModifiersSchema,
  targetSchema,
} from "./schema";
import { STEPS_BY_KEYWORD } from "./steps";
import { paramValueSchema } from "./template-params";
import type {
  INormalizeScope,
  IRepeatStep,
  IStepLocation,
  IStepNode,
  ITemplateSignature,
  IYamlNodePath,
} from "./types";
import { isRecord } from "./variables";

const PLACEHOLDER = /\$\{([^}]+)\}/g;

export function containsPlaceholder(value: unknown): boolean {
  return (JSON.stringify(value ?? null) ?? "").includes("${");
}

function collectPlaceholderPaths(value: unknown): string[] {
  if (typeof value === "string") {
    return [...value.matchAll(PLACEHOLDER)].map((match) => match[1].trim());
  }
  if (Array.isArray(value)) {
    return value.flatMap((item: unknown) => collectPlaceholderPaths(item));
  }
  if (isRecord(value)) {
    return Object.values(value).flatMap((item) =>
      collectPlaceholderPaths(item)
    );
  }
  return [];
}

/** A call passes its params as a mapping; a bare `- template_name:` or `true` passes none. */
export function callArguments(args: unknown): Record<string, unknown> | null {
  if (args === null || args === undefined || args === true) {
    return {};
  }
  return isRecord(args) ? args : null;
}

function locate(
  scope: INormalizeScope,
  nodePath: IYamlNodePath
): IStepLocation {
  const line = scope.document.lineOf(nodePath);
  return {
    file: scope.file,
    line,
    label:
      line === null
        ? `${scope.file} › ${nodePath.join(".")}`
        : `${scope.file}:${line}`,
  };
}

// ${params.x} and `when: params.x` exist only inside a template, and only for declared params.
function checkParamReferences(
  step: Record<string, unknown>,
  keyword: string,
  scope: INormalizeScope,
  location: IStepLocation
): void {
  const conditionPaths = [step.when, step.unless].filter(
    (condition): condition is string => typeof condition === "string"
  );
  const referencedPaths = [
    ...collectPlaceholderPaths(step[keyword]),
    ...conditionPaths.map((condition) => condition.trim()),
  ];

  for (const dottedPath of referencedPaths) {
    const [root, paramName] = dottedPath.split(".");
    if (root !== PARAMS_VARIABLE) {
      continue;
    }
    if (scope.declaredParams === null) {
      throw new Error(
        `${location.label}: "${dottedPath}" — params exist only inside a template`
      );
    }
    if (paramName === undefined || !scope.declaredParams.has(paramName)) {
      const declared = [...scope.declaredParams].join(", ") || "none";
      throw new Error(
        `${location.label}: unknown param "${
          paramName ?? ""
        }" in "${dottedPath}" — declared: ${declared}`
      );
    }
  }
}

function checkTemplateCall(
  signature: ITemplateSignature,
  args: unknown,
  location: IStepLocation
): void {
  const where = `${location.label} (${signature.name})`;
  const provided = callArguments(args);
  if (provided === null) {
    throw new Error(`${where}: pass the params as a mapping`);
  }

  const declaredNames = signature.params.map((param) => param.name);
  const unknownNames = Object.keys(provided).filter(
    (name) => !declaredNames.includes(name)
  );
  if (unknownNames.length > 0) {
    throw new Error(
      `${where}: unknown param ${unknownNames.join(", ")} — declared: ${
        declaredNames.join(", ") || "none"
      }`
    );
  }

  for (const param of signature.params) {
    if (!(param.name in provided)) {
      if (param.required) {
        throw new Error(`${where}: missing param "${param.name}"`);
      }
      continue;
    }
    // A ${placeholder} is checked at run time, once its value is known.
    const value = provided[param.name];
    if (containsPlaceholder(value)) {
      continue;
    }
    const validation = paramValueSchema(param.type).safeParse(value);
    if (!validation.success) {
      throw new Error(
        `${where}: param "${param.name}" — ${z.prettifyError(validation.error)}`
      );
    }
  }
}

function normalizeStep(
  step: Record<string, unknown>,
  index: number,
  nodePath: IYamlNodePath,
  scope: INormalizeScope
): IStepNode {
  const location = locate(scope, nodePath);
  const actionKeys = Object.keys(step).filter(
    (key) => !STEP_MODIFIER_KEYS.has(key)
  );
  if (actionKeys.length !== 1) {
    const found = actionKeys.length === 0 ? "none" : actionKeys.join(", ");
    throw new Error(
      `${location.label}: a step needs exactly one action, found ${found}`
    );
  }

  const keyword = actionKeys[0];
  const modifiers = stepModifiersSchema.safeParse(
    Object.fromEntries(
      Object.entries(step).filter(([key]) => STEP_MODIFIER_KEYS.has(key))
    )
  );
  if (!modifiers.success) {
    throw new Error(`${location.label}: ${z.prettifyError(modifiers.error)}`);
  }
  checkParamReferences(step, keyword, scope, location);

  const args = step[keyword];
  const shared = { position: index + 1, location, ...modifiers.data };

  if (keyword === REPEAT_KEYWORD) {
    return { ...normalizeRepeat(args, nodePath, scope, location), ...shared };
  }

  const definition = STEPS_BY_KEYWORD.get(keyword);
  if (definition !== undefined) {
    // Arguments with ${placeholders} are validated at run time, once their values are known.
    if (!containsPlaceholder(args)) {
      const validation = definition.schema.safeParse(args);
      if (!validation.success) {
        throw new Error(
          `${location.label} (${keyword}): ${z.prettifyError(validation.error)}`
        );
      }
    }
    return { kind: "action", keyword, args, ...shared };
  }

  const signature = scope.templates.get(keyword);
  if (signature !== undefined) {
    checkTemplateCall(signature, args, location);
    return { kind: "template", template: keyword, args, ...shared };
  }

  const steps = [...STEPS_BY_KEYWORD.keys()].join(", ");
  const templates = [...scope.templates.keys()].join(", ") || "none";
  throw new Error(
    `${location.label}: unknown step "${keyword}" — steps: ${steps}; templates: ${templates}`
  );
}

// `repeat` holds its own steps, normalized like any others (and pointing at their own lines).
function normalizeRepeat(
  args: unknown,
  nodePath: IYamlNodePath,
  scope: INormalizeScope,
  location: IStepLocation
): Pick<IRepeatStep, "kind" | "until" | "max" | "steps"> {
  const parsed = repeatArgsSchema.safeParse(args);
  if (!parsed.success) {
    throw new Error(
      `${location.label} (${REPEAT_KEYWORD}): ${z.prettifyError(parsed.error)}`
    );
  }
  if (!containsPlaceholder(parsed.data.until)) {
    const until = targetSchema.safeParse(parsed.data.until);
    if (!until.success) {
      throw new Error(
        `${location.label} (${REPEAT_KEYWORD}.until): ${z.prettifyError(
          until.error
        )}`
      );
    }
  }

  return {
    kind: "repeat",
    until: parsed.data.until,
    max: parsed.data.max,
    steps: normalizeSteps(
      parsed.data.steps,
      [...nodePath, REPEAT_KEYWORD, "steps"],
      scope
    ),
  };
}

/** Validates YAML steps (built-in steps, template calls, repeat blocks) and records their lines. */
export function normalizeSteps(
  rawSteps: Record<string, unknown>[],
  stepsPath: IYamlNodePath,
  scope: INormalizeScope
): IStepNode[] {
  return rawSteps.map((step, index) =>
    normalizeStep(step, index, [...stepsPath, index], scope)
  );
}
