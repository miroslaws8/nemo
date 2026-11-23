import { expect, type Locator } from "@playwright/test";
import { z } from "zod";
import {
  courseVariableSchema,
  lastAssetVariableSchema,
  pageComponentSchema,
  type IComponentAsset,
} from "../api-schemas";
import { durationSchema, parseDuration } from "../schema";
import type { IRunContext } from "../types";
import { defineStep } from "./define-step";

const BUSY_STATUSES: ReadonlySet<string> = new Set(["queued", "generating"]);
const POLL_INTERVAL_MS = 5_000;

function readCourse(
  context: IRunContext
): z.infer<typeof courseVariableSchema> {
  const course = courseVariableSchema.safeParse(context.variables.course);
  if (!course.success) {
    throw new Error(
      "This step needs a course — add blank_course to the suite's setup"
    );
  }
  return course.data;
}

export function findLastAssetId(context: IRunContext): number | null {
  const lastAsset = lastAssetVariableSchema.safeParse(
    context.variables.last_asset
  );
  return lastAsset.success ? lastAsset.data.id : null;
}

function assetElement(context: IRunContext, assetId: number): Locator {
  return context.page.locator(`[data-asset-id="${assetId}"]`);
}

function toAssetList(
  component: z.infer<typeof pageComponentSchema>
): IComponentAsset[] {
  if (Array.isArray(component)) {
    return component;
  }
  return "assets" in component ? component.assets : component.components;
}

// Polls the API, not the DOM: the builder page is heavy, and the API status is the source of
// truth for generation. Adding is async, so "no assets yet" also means "keep waiting".
async function waitForSettledAssets(
  context: IRunContext,
  timeoutMs: number
): Promise<IComponentAsset[]> {
  const course = readCourse(context);
  const componentPath = `/api/instances/${course.instance_id}/hubs/${course.hub_id}/builder/sections/${course.section_id}/pages/${course.page_id}/component`;
  const deadline = Date.now() + timeoutMs;
  let assets: IComponentAsset[] = [];

  while (Date.now() < deadline) {
    assets = toAssetList(
      await context.api.get(componentPath, pageComponentSchema)
    );
    const settled =
      assets.length > 0 &&
      assets.every(
        (asset) => !BUSY_STATUSES.has(asset.generation_status ?? "")
      );
    if (settled) {
      return assets;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  const statuses = assets
    .map((asset) => `${asset.type}:${asset.generation_status ?? "manual"}`)
    .join(", ");
  throw new Error(
    `Assets did not settle within ${Math.round(timeoutMs / 1000)}s [${
      statuses || "no assets yet"
    }]`
  );
}

// The builder updates live over websockets; a reload is a fallback, flagged in the report.
async function waitUntilShownInUi(
  context: IRunContext,
  assetId: number,
  timeoutMs: number
): Promise<void> {
  const element = assetElement(context, assetId);
  try {
    await element.waitFor({ state: "visible", timeout: timeoutMs });
  } catch {
    await context.page.reload({ waitUntil: "domcontentloaded" });
    await element.waitFor({ state: "visible", timeout: timeoutMs });
    context.testInfo.annotations.push({
      type: "warning",
      description: `Asset ${assetId} showed up only after a reload — the live update was missed`,
    });
  }
}

export const waitAssetStep = defineStep({
  keyword: "wait_asset",
  schema: z.strictObject({
    type: z.string().min(1).optional(),
    timeout: durationSchema.optional(),
    ui_timeout: durationSchema.optional(),
  }),
  describe: (args) =>
    `wait for the ${args.type ?? "new"} asset to finish generating`,
  run: async (args, context) => {
    const assets = await waitForSettledAssets(
      context,
      parseDuration(args.timeout, 15 * 60_000)
    );
    const newest = assets.reduce((latest, asset) =>
      asset.id > latest.id ? asset : latest
    );

    if (args.type !== undefined && newest.type !== args.type) {
      throw new Error(
        `The page got a "${newest.type}" asset, expected "${args.type}"`
      );
    }
    if (newest.generation_status === "failed") {
      throw new Error(
        `Generation failed for the ${newest.type} asset ${newest.id}`
      );
    }

    const status = newest.generation_status ?? "manual";
    context.variables.last_asset = { id: newest.id, type: newest.type, status };
    context.testInfo.annotations.push({
      type: "asset",
      description: `${newest.type} #${newest.id} — ${status}`,
    });

    await waitUntilShownInUi(
      context,
      newest.id,
      parseDuration(args.ui_timeout, 2 * 60_000)
    );
  },
});

// Lazy images load only once scrolled into view, so the first pending one is scrolled to on
// every retry. A broken image (complete, but 0px wide) never resolves and fails the check.
async function countUnloadedImages(element: Locator): Promise<number> {
  return element.evaluate((node) => {
    const pending = Array.from(node.querySelectorAll("img")).filter(
      (image) => !image.complete || image.naturalWidth === 0
    );
    pending[0]?.scrollIntoView({ block: "center" });
    return pending.length;
  });
}

export const expectAssetStep = defineStep({
  keyword: "expect_asset",
  observesOnly: true,
  schema: z.strictObject({
    id: z.coerce.number().int().positive().optional(),
    min_height: z.number().nonnegative().optional(),
    not_text: z.array(z.string().min(1)).optional(),
    images_loaded: z.boolean().optional(),
    timeout: durationSchema.optional(),
  }),
  describe: (args) => `expect the asset rendered (≥ ${args.min_height ?? 1}px)`,
  run: async (args, context) => {
    const assetId = args.id ?? findLastAssetId(context);
    if (assetId === null) {
      throw new Error(
        "expect_asset needs wait_asset before it (or an explicit id)"
      );
    }

    const element = assetElement(context, assetId);
    const minHeight = args.min_height ?? 1;
    const forbiddenPhrases = args.not_text ?? ["Unknown component type"];
    let height = 0;

    await element.scrollIntoViewIfNeeded();
    await expect(async () => {
      height = Math.round((await element.boundingBox())?.height ?? 0);
      expect(height, "asset height in px").toBeGreaterThanOrEqual(minHeight);

      const text = await element.innerText();
      for (const phrase of forbiddenPhrases) {
        expect(text, `asset text contains "${phrase}"`).not.toContain(phrase);
      }

      if (args.images_loaded) {
        expect(
          await countUnloadedImages(element),
          "images still loading or broken"
        ).toBe(0);
      }
    }).toPass({ timeout: parseDuration(args.timeout, 3 * 60_000) });

    await element.scrollIntoViewIfNeeded();
    context.testInfo.annotations.push({
      type: "asset-height",
      description: `${height}px`,
    });
  },
});
