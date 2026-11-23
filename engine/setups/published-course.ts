import { z } from "zod";
import { loadE2eConfig } from "../config";
import {
  addManualAsset,
  addPage,
  createCourse,
  publishCourse,
  readPageTitles,
  waitForAssets,
} from "../course-builder";
import { dataTitle } from "../run-info";
import { variableNameSchema } from "../schema";
import type { ICoursePage, IRunContext } from "../types";
import { defineSetup } from "./define-setup";

const ASSETS_TIMEOUT_MS = 60_000;

const paramsSchema = z.strictObject({
  as: variableNameSchema.default("course"),
  // Pages in total, the course's default page included; each gets one manual asset.
  pages: z.number().int().min(1).max(5).default(2),
  // A manual-only type (no AI, no credits), added with its default content.
  asset: z.string().min(1).default("content_block"),
});

// A published course a learner can open: every page holds one asset, so each page renders
// something. Built through the API; deleted after the test like any course the tests create.
async function createPublishedCourse(
  params: z.infer<typeof paramsSchema>,
  context: IRunContext
): Promise<void> {
  const { environment, testInfo } = context;
  const prefix = loadE2eConfig().safety.data_prefix;
  const title = dataTitle(
    params.as === "course" ? testInfo.title : `${testInfo.title} ${params.as}`
  );
  const course = await createCourse(context, title);

  const pages: ICoursePage[] = [...course.pages];
  while (pages.length < params.pages) {
    pages.push(
      await addPage(context, course, `${prefix}page ${pages.length + 1}`)
    );
  }
  for (const page of pages.slice(0, params.pages)) {
    await addManualAsset(context, course, page.id, params.asset);
  }
  const assetIds: number[] = [];
  for (const page of pages.slice(0, params.pages)) {
    const assets = await waitForAssets(
      context,
      course,
      page.id,
      ASSETS_TIMEOUT_MS
    );
    assetIds.push(...assets.map((asset) => asset.id));
  }
  await publishCourse(context, course);
  const titles = await readPageTitles(context, course);

  const learnerBase = `${environment.baseUrl}/hub/${course.hubId}/course`;
  context.variables[params.as] = {
    title,
    hub_id: course.hubId,
    chat_id: course.chatId,
    learner_url: learnerBase,
    pages: pages.slice(0, params.pages).map((page) => ({
      id: page.id,
      hash: page.hash,
      title: titles.get(page.id) ?? "",
      learner_url: `${learnerBase}/${page.hash}`,
      preview_url: `${course.builderUrl}/${page.hash}?mode=preview`,
    })),
    asset_ids: assetIds,
  };
  testInfo.annotations.push({
    type: "course",
    description: `${title} — hub ${course.hubId}, ${params.pages} published page(s) — ${learnerBase}`,
  });
}

export const publishedCourseSetup = defineSetup({
  name: "published_course",
  mode: "creates",
  params: paramsSchema,
  run: createPublishedCourse,
});
