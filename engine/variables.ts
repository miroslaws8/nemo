import type { IInterpolationOptions, IVariables } from "./types";

const PLACEHOLDER = /\$\{([^}]+)\}/g;
const WHOLE_PLACEHOLDER = /^\$\{([^}]+)\}$/;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// A path segment that is a number indexes into a list: ${course.pages.1.learner_url}.
function readSegment(current: unknown, segment: string): unknown {
  if (Array.isArray(current)) {
    const index = Number(segment);
    return Number.isInteger(index) ? current.at(index) : undefined;
  }
  if (isRecord(current) && segment in current) {
    return current[segment];
  }
  return undefined;
}

export function readVariable(
  variables: IVariables,
  dottedPath: string
): unknown {
  let current: unknown = variables;

  for (const segment of dottedPath.trim().split(".")) {
    current = readSegment(current, segment);
    if (current === undefined) {
      return undefined;
    }
  }

  return current;
}

/** Replaces ${path} placeholders; a value that is exactly one placeholder keeps its type. */
export function interpolate(
  value: unknown,
  variables: IVariables,
  options: IInterpolationOptions
): unknown {
  if (typeof value === "string") {
    return interpolateText(value, variables, options);
  }
  if (Array.isArray(value)) {
    return value.map((item: unknown) => interpolate(item, variables, options));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        interpolate(item, variables, options),
      ])
    );
  }
  return value;
}

function interpolateText(
  text: string,
  variables: IVariables,
  options: IInterpolationOptions
): unknown {
  const whole = text.match(WHOLE_PLACEHOLDER);
  if (whole) {
    const resolved = readVariable(variables, whole[1]);
    return resolved === undefined
      ? unresolved(text, whole[1], options)
      : resolved;
  }

  return text.replace(
    PLACEHOLDER,
    (placeholder: string, dottedPath: string) => {
      const resolved = readVariable(variables, dottedPath);
      return resolved === undefined
        ? unresolved(placeholder, dottedPath, options)
        : String(resolved);
    }
  );
}

function unresolved(
  placeholder: string,
  dottedPath: string,
  options: IInterpolationOptions
): string {
  if (options.strict) {
    throw new Error(`Unknown variable \${${dottedPath}}`);
  }
  return placeholder;
}

/** `when`/`unless` take a variable path; an unknown path is an authoring error, not "false". */
export function evaluateCondition(
  variables: IVariables,
  expression: string
): boolean {
  const value = readVariable(variables, expression);
  if (value === undefined) {
    throw new Error(`Condition "${expression}" refers to an unknown variable`);
  }
  return Boolean(value);
}
