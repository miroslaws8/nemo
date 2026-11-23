import type { Locator, Page } from "@playwright/test";
import { ARIA_ROLES, LOCATOR_KEYS } from "./schema";
import type { ILocatorKey, ILocatorResolver, ITarget } from "./types";

function toAriaRole(value: string): (typeof ARIA_ROLES)[number] {
  const role = ARIA_ROLES.find((candidate) => candidate === value);
  if (role === undefined) {
    throw new Error(`Unknown ARIA role "${value}"`);
  }
  return role;
}

// Names match exactly (and case-sensitively) by default: "Add asset" on the page and
// "Add Asset" in the modal are different buttons.
const LOCATOR_RESOLVERS: Record<ILocatorKey, ILocatorResolver> = {
  button: (scope, value, target) =>
    scope.getByRole("button", { name: value, exact: target.exact ?? true }),
  role: (scope, value, target) =>
    target.name === undefined
      ? scope.getByRole(toAriaRole(value))
      : scope.getByRole(toAriaRole(value), {
          name: target.name,
          exact: target.exact ?? true,
        }),
  text: (scope, value, target) =>
    scope.getByText(value, { exact: target.exact ?? true }),
  css: (scope, value) => scope.locator(value),
  placeholder: (scope, value, target) =>
    scope.getByPlaceholder(value, { exact: target.exact ?? true }),
  label: (scope, value, target) =>
    scope.getByLabel(value, { exact: target.exact ?? true }),
  testid: (scope, value) => scope.getByTestId(value),
};

function findLocatorKey(target: ITarget): ILocatorKey {
  const key = LOCATOR_KEYS.find((candidate) => target[candidate] !== undefined);
  if (key === undefined) {
    throw new Error(`A target needs one of: ${LOCATOR_KEYS.join(", ")}`);
  }
  return key;
}

function applyTextFilter(locator: Locator, target: ITarget): Locator {
  if (target.has_text === undefined && target.has_not_text === undefined) {
    return locator;
  }
  return locator.filter({
    ...(target.has_text === undefined ? {} : { hasText: target.has_text }),
    ...(target.has_not_text === undefined
      ? {}
      : { hasNotText: target.has_not_text }),
  });
}

export function locate(page: Page, target: ITarget): Locator {
  const key = findLocatorKey(target);
  const value = String(target[key]);
  const scope = target.in === undefined ? page : page.getByRole(target.in);
  const locator = applyTextFilter(
    LOCATOR_RESOLVERS[key](scope, value, target),
    target
  );
  return target.nth === undefined ? locator : locator.nth(target.nth);
}

export function describeTarget(target: ITarget): string {
  const key = findLocatorKey(target);
  const scope = target.in === undefined ? "" : ` in ${target.in}`;
  const withText =
    target.has_text === undefined ? "" : ` with "${target.has_text}"`;
  const withoutText =
    target.has_not_text === undefined
      ? ""
      : ` without "${target.has_not_text}"`;
  return `${key} "${String(target[key])}"${scope}${withText}${withoutText}`;
}
