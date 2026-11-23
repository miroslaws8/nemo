import type { IRegisteredSetup } from "../types";

/**
 * Names usable in a suite's `setup:` list; they run in order before each test. None ship: a setup
 * creates or finds the app's own records through its API, so it is written for each app — a file
 * here with defineSetup(...) (./define-setup.ts) and one line in this list (docs/guide.md → Setups).
 */
export const SETUPS: readonly IRegisteredSetup[] = [];

export const SETUPS_BY_NAME: ReadonlyMap<string, IRegisteredSetup> = new Map(
  SETUPS.map((setup) => [setup.name, setup])
);
