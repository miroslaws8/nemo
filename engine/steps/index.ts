import type { IRegisteredStep } from "../types";
import { aiCheckStep } from "./ai-check";
import {
  expectHiddenStep,
  expectNoErrorsStep,
  expectStep,
  expectVisibleStep,
} from "./assertions";
import { expectAssetStep, waitAssetStep } from "./assets";
import { clickStep, fillStep, pressStep } from "./interaction";
import { expectFitsWidthStep } from "./layout";
import { expectUrlStep, gotoStep } from "./navigation";
import { trackStep } from "./track";

/** Every YAML step keyword. A new keyword = a new defineStep(...) added here. */
export const STEPS: readonly IRegisteredStep[] = [
  gotoStep,
  expectUrlStep,
  clickStep,
  fillStep,
  pressStep,
  expectStep,
  expectVisibleStep,
  expectHiddenStep,
  expectNoErrorsStep,
  expectFitsWidthStep,
  waitAssetStep,
  expectAssetStep,
  aiCheckStep,
  trackStep,
];

export const STEPS_BY_KEYWORD: ReadonlyMap<string, IRegisteredStep> = new Map(
  STEPS.map((step) => [step.keyword, step])
);
