import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  blankChatSchema,
  createdPageSchema,
  pageComponentSchema,
  sectionsSchema,
  type IComponentAsset,
} from "./api-schemas";
import type { ICoursePage, ICreatedCourse, IRunContext } from "./types";

// Course scaffolding through the API (no AI, no credits), shared by the course setups.

const BUSY_STATUSES: ReadonlySet<string> = new Set(["queued", "generating"]);
const POLL_INTERVAL_MS = 2_000;

/**
 * A blank course, renamed to `title` and tracked for cleanup straight away: cleanup only deletes
 * titles with the data prefix, so a course left as "Untitled course" by a later failure would be
 * stranded.
 */
export async function createCourse(
  context: IRunContext,
  title: string
): Promise<ICreatedCourse> {
  const { api, environment } = context;
  const { instanceId, workspaceId } = await api.resolveInstance();

  const chat = await api.post(
    `/api/workspaces/${workspaceId}/ai/builder/chat/`,
    { type: "blank" },
    blankChatSchema
  );
  await api.post(
    `/api/instances/${instanceId}/hubs/${chat.hub_id}/update`,
    { title },
    z.unknown()
  );
  const builderUrl = `${environment.baseUrl}/hub/${chat.hub_id}/${chat.chat_id}/ai-builder`;
  context.resources.track({
    kind: "course",
    id: chat.hub_id,
    title,
    url: builderUrl,
  });

  const sections = await api.get(
    `/api/instances/${instanceId}/hubs/${chat.hub_id}/builder/sections`,
    sectionsSchema
  );
  const firstSection = sections.at(0);
  if (firstSection === undefined) {
    throw new Error(`The blank course ${chat.hub_id} has no section`);
  }

  return {
    title,
    hubId: chat.hub_id,
    chatId: chat.chat_id,
    instanceId,
    workspaceId,
    sectionId: firstSection.id,
    builderUrl,
    pages: firstSection.pages,
  };
}

/** The titles the course's pages have now, by page id (the API names new pages itself). */
export async function readPageTitles(
  context: IRunContext,
  course: ICreatedCourse
): Promise<Map<number, string>> {
  const sections = await context.api.get(
    `/api/instances/${course.instanceId}/hubs/${course.hubId}/builder/sections`,
    sectionsSchema
  );
  return new Map(
    sections.flatMap((section) =>
      section.pages.map((page): [number, string] => [page.id, page.title ?? ""])
    )
  );
}

export async function addPage(
  context: IRunContext,
  course: ICreatedCourse,
  title: string
): Promise<ICoursePage> {
  return context.api.post(
    `/api/instances/${course.instanceId}/hubs/${course.hubId}/builder/sections/${course.sectionId}/pages`,
    { type: "page", title },
    createdPageSchema
  );
}

/** Adds an asset with its default content (no AI). The add is asynchronous: see waitForAssets. */
export async function addManualAsset(
  context: IRunContext,
  course: ICreatedCourse,
  pageId: number,
  assetType: string
): Promise<void> {
  await context.api.post(
    `/api/workspaces/${course.workspaceId}/ai/builder/chat/${course.chatId}/assets`,
    {
      page_id: pageId,
      asset_type: assetType,
      with_ai: false,
      rich_effects: false,
      force_qa: false,
      client_request_id: randomUUID(),
    },
    z.unknown()
  );
}

function toAssetList(
  component: z.infer<typeof pageComponentSchema>
): IComponentAsset[] {
  if (Array.isArray(component)) {
    return component;
  }
  return "assets" in component ? component.assets : component.components;
}

/** The assets a page holds right now, with their generation status. */
export async function readPageAssets(
  context: IRunContext,
  course: Pick<ICreatedCourse, "instanceId" | "hubId" | "sectionId">,
  pageId: number
): Promise<IComponentAsset[]> {
  return toAssetList(
    await context.api.get(
      `/api/instances/${course.instanceId}/hubs/${course.hubId}/builder/sections/${course.sectionId}/pages/${pageId}/component`,
      pageComponentSchema
    )
  );
}

/** Polls a page until it has assets and none of them is still being generated. */
export async function waitForAssets(
  context: IRunContext,
  course: ICreatedCourse,
  pageId: number,
  timeoutMs: number
): Promise<IComponentAsset[]> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const assets = await readPageAssets(context, course, pageId);
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
  throw new Error(
    `Page ${pageId} of course ${
      course.hubId
    } got no settled asset within ${Math.round(timeoutMs / 1000)}s`
  );
}

/** A draft course's learner view redirects to a "not published" page, so viewing needs this. */
export async function publishCourse(
  context: IRunContext,
  course: ICreatedCourse
): Promise<void> {
  await context.api.post(
    `/api/instances/alias/${context.api.alias}/courses/${course.hubId}/publish`,
    {},
    z.unknown()
  );
}
