import { z } from "zod";
import { describeTarget, locate } from "../locate";
import {
  hasSingleLocator,
  SINGLE_LOCATOR_MESSAGE,
  TARGET_SHAPE,
  targetSchema,
} from "../schema";
import { defineStep } from "./define-step";

export const clickStep = defineStep({
  keyword: "click",
  schema: targetSchema,
  describe: (target) => `click ${describeTarget(target)}`,
  run: async (target, { page }) => {
    await locate(page, target).click();
  },
});

const fillSchema = z
  .strictObject({ ...TARGET_SHAPE, value: z.string() })
  .refine(hasSingleLocator, SINGLE_LOCATOR_MESSAGE);

export const fillStep = defineStep({
  keyword: "fill",
  schema: fillSchema,
  describe: (args) => `fill ${describeTarget(args)} with "${args.value}"`,
  run: async (args, { page }) => {
    await locate(page, args).fill(args.value);
  },
});

// `press: Enter` presses a key on whatever has focus; with a target the key goes to it.
const pressSchema = z.union([
  z.string().min(1),
  z
    .strictObject({ ...TARGET_SHAPE, key: z.string().min(1) })
    .refine(hasSingleLocator, SINGLE_LOCATOR_MESSAGE),
]);

export const pressStep = defineStep({
  keyword: "press",
  schema: pressSchema,
  describe: (args) =>
    typeof args === "string"
      ? `press ${args}`
      : `press ${args.key} in ${describeTarget(args)}`,
  run: async (args, { page }) => {
    if (typeof args === "string") {
      await page.keyboard.press(args);
      return;
    }
    await locate(page, args).press(args.key);
  },
});
