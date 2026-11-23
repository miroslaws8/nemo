import { z } from "zod";
import { listedCourseSchema, sectionsSchema } from "../api-schemas";
import { readPageAssets } from "../course-builder";
import { variableNameSchema } from "../schema";
import type { IRunContext } from "../types";
import { defineSetup } from "./define-setup";

const paramsSchema = z.strictObject({
  as: variableNameSchema.default("zoo"),
  // The fixture's title starts with this; the Hermes skill /qa-asset-zoo adds a date to it.
  title: z.string().min(1).default("[SMOKE] Asset Zoo"),
});

const assetRowSchema = z.looseObject({ type: z.string().min(1) });

// The search also matches course content; a handful of pages covers every title match.
const MAX_SEARCH_PAGES = 5;

// The skill stamps the build time after the title ("[SMOKE] Asset Zoo 2026-11-10 15:56"); the
// one-asset courses of /qa-asset-add ("[SMOKE] Asset Zoo UI …") are not the fixture.
const BUILD_STAMP_PATTERN = /^ \d{4}-\d{2}-\d{2}/;

function isZooTitle(title: string, prefix: string): boolean {
  return (
    title === prefix ||
    (title.startsWith(prefix) &&
      BUILD_STAMP_PATTERN.test(title.slice(prefix.length)))
  );
}

type IListedCourse = z.infer<typeof listedCourseSchema>;

async function findZooCourse(
  context: IRunContext,
  instanceId: number,
  titlePrefix: string
): Promise<IListedCourse | null> {
  const searchPath = `/api/instances/${instanceId}/hubs?search=${encodeURIComponent(
    titlePrefix
  )}`;
  const zoos: IListedCourse[] = [];
  for (let page = 1; page <= MAX_SEARCH_PAGES; page += 1) {
    const result = await context.api.getPage(
      searchPath,
      listedCourseSchema,
      page
    );
    zoos.push(
      ...result.items.filter((course) =>
        isZooTitle(course.title ?? "", titlePrefix)
      )
    );
    if (page >= result.lastPage) {
      break;
    }
  }
  // A rebuilt zoo is the newest one.
  return zoos.reduce<IListedCourse | null>(
    (newest, course) =>
      newest === null || course.id > newest.id ? course : newest,
    null
  );
}

// Read-only: finds the fixture course that holds one AI-generated asset of every type (built by
// the Hermes skill /qa-asset-zoo) and points the test at the row's asset in the author
// preview, which shows every asset of a page at once. Skips the test where no zoo was built.
async function resolveZooAsset(
  params: z.infer<typeof paramsSchema>,
  context: IRunContext
): Promise<void> {
  const { api, environment, testInfo } = context;
  const row = assetRowSchema.safeParse(context.variables.asset);
  if (!row.success) {
    throw new Error(
      "asset_zoo needs an `asset` row with `type` — use each: { as: asset, from: data/asset-zoo.yaml }"
    );
  }
  const assetType = row.data.type;

  const { instanceId } = await api.resolveInstance();
  const zoo = await findZooCourse(context, instanceId, params.title);
  testInfo.skip(
    zoo === null,
    `No "${params.title}" course on ${environment.name} — build it with the Hermes skill: /qa-asset-zoo ${environment.name}`
  );
  if (zoo === null) {
    return;
  }
  const chatId = zoo.chat?.id;
  if (chatId === undefined) {
    throw new Error(
      `"${zoo.title}" (course ${zoo.id}) was not built in the AI builder`
    );
  }

  const sections = await api.get(
    `/api/instances/${instanceId}/hubs/${zoo.id}/builder/sections`,
    sectionsSchema
  );
  for (const section of sections) {
    for (const page of section.pages) {
      const assets = await readPageAssets(
        context,
        { instanceId, hubId: zoo.id, sectionId: section.id },
        page.id
      );
      const asset = assets.find((candidate) => candidate.type === assetType);
      if (asset === undefined) {
        continue;
      }
      if (asset.generation_status === "failed") {
        throw new Error(
          `The ${assetType} asset ${asset.id} failed to generate in "${zoo.title}" — rebuild the zoo: /qa-asset-zoo ${environment.name}`
        );
      }

      const status = asset.generation_status ?? "manual";
      const previewUrl = `${environment.baseUrl}/hub/${zoo.id}/${chatId}/ai-builder/${page.hash}?mode=preview`;
      context.variables[params.as] = {
        title: zoo.title ?? "",
        hub_id: zoo.id,
        chat_id: chatId,
        asset_id: asset.id,
        page_hash: page.hash,
        preview_url: previewUrl,
      };
      // expect_asset and ai_check default to the last asset, as after wait_asset.
      context.variables.last_asset = { id: asset.id, type: asset.type, status };
      testInfo.annotations.push({
        type: "asset",
        description: `${asset.type} #${asset.id} — ${status} — ${previewUrl}`,
      });
      return;
    }
  }
  throw new Error(
    `"${zoo.title}" (course ${zoo.id}) has no ${assetType} asset — rebuild the zoo: /qa-asset-zoo ${environment.name}`
  );
}

export const assetZooSetup = defineSetup({
  name: "asset_zoo",
  mode: "readonly",
  params: paramsSchema,
  run: resolveZooAsset,
});
