import { z } from "zod";
import { loadE2eConfig } from "../config";
import { addPage, createCourse } from "../course-builder";
import { dataTitle } from "../run-info";
import { variableNameSchema } from "../schema";
import type { IRunContext } from "../types";
import { defineSetup } from "./define-setup";

const paramsSchema = z.strictObject({
  // The variable the course lands in, so one test can create several: { blank_course: { as: other } }.
  as: variableNameSchema.default("course"),
});

// Scaffolding only, through the API (no AI, no credits): the test exercises the UI on top of it.
async function createBlankCourse(
  params: z.infer<typeof paramsSchema>,
  context: IRunContext
): Promise<void> {
  const { testInfo } = context;
  const title = dataTitle(
    params.as === "course" ? testInfo.title : `${testInfo.title} ${params.as}`
  );
  const course = await createCourse(context, title);
  const page = await addPage(
    context,
    course,
    `${loadE2eConfig().safety.data_prefix}page`
  );

  // Pages are routed by hash; the numeric page id is only for API calls.
  const editUrl = `${course.builderUrl}/${page.hash}`;

  context.variables[params.as] = {
    title,
    hub_id: course.hubId,
    chat_id: course.chatId,
    instance_id: course.instanceId,
    workspace_id: course.workspaceId,
    section_id: course.sectionId,
    page_id: page.id,
    page_hash: page.hash,
    edit_url: editUrl,
  };
  testInfo.annotations.push({
    type: "course",
    description: `${title} — hub ${course.hubId} — ${editUrl}`,
  });
}

export const blankCourseSetup = defineSetup({
  name: "blank_course",
  mode: "creates",
  params: paramsSchema,
  run: createBlankCourse,
});
