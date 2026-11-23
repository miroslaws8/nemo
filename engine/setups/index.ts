import type { IRegisteredSetup } from "../types";
import { assetZooSetup } from "./asset-zoo";
import { blankCourseSetup } from "./blank-course";
import { publishedCourseSetup } from "./published-course";
import { quizSetup } from "./quiz";
import { resolveAssetSetup } from "./resolve-asset";

/** Names usable in a suite's `setup:` list; they run in order before each test. */
export const SETUPS: readonly IRegisteredSetup[] = [
  assetZooSetup,
  blankCourseSetup,
  publishedCourseSetup,
  quizSetup,
  resolveAssetSetup,
];

export const SETUPS_BY_NAME: ReadonlyMap<string, IRegisteredSetup> = new Map(
  SETUPS.map((setup) => [setup.name, setup])
);
