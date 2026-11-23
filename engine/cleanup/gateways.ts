import { z } from "zod";
import type { ApiClient } from "../api-client";
import {
  courseRecordSchema,
  learningPathRecordSchema,
  quizRecordSchema,
} from "../api-schemas";
import type {
  IOwnedRecord,
  IPage,
  IResourceGateway,
  IResourceKind,
} from "../types";

// A test user owns a few dozen records at most; more pages than this means a wrong query.
const MAX_PAGES = 50;

function toDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function readAllPages<TItem>(
  loadPage: (page: number) => Promise<IPage<TItem>>
): Promise<TItem[]> {
  const items: TItem[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const result = await loadPage(page);
    items.push(...result.items);
    if (page >= result.lastPage) {
      return items;
    }
  }
  throw new Error(`more than ${MAX_PAGES} pages — refusing to read further`);
}

function courseRecord(
  course: z.infer<typeof courseRecordSchema>,
  trashed: boolean
): IOwnedRecord {
  return {
    kind: "course",
    id: course.id,
    title: course.title ?? "",
    ownerId: course.owner_id ?? null,
    createdAt: toDate(course.created_at),
    trashed: trashed || Boolean(course.deleted_at),
  };
}

// A soft delete moves a course to the trash (Recently deleted); delete_trashed removes it for good.
const courseGateway: IResourceGateway = {
  kind: "course",
  fetch: async (api: ApiClient, id: number): Promise<IOwnedRecord | null> => {
    const { instanceId } = await api.resolveInstance();
    const course = await api.find(
      `/api/instances/${instanceId}/hubs/${id}`,
      courseRecordSchema
    );
    return course === null ? null : courseRecord(course, false);
  },
  listOwned: async (
    api: ApiClient,
    ownerId: number
  ): Promise<IOwnedRecord[]> => {
    const { instanceId } = await api.resolveInstance();
    const active = await readAllPages((page) =>
      api.getPage(
        `/api/instances/${instanceId}/hubs?only_own=1&order_by=created_at&direction=asc`,
        courseRecordSchema,
        page
      )
    );
    // The trash lists only the caller's own courses; it also catches half-finished deletions.
    const trashed = await readAllPages((page) =>
      api.getPage(
        `/api/instances/${instanceId}/hubs/trashed`,
        courseRecordSchema,
        page
      )
    );
    return [
      ...active.map((course) => courseRecord(course, false)),
      ...trashed.map((course) => courseRecord(course, true)),
    ].filter((record) => record.ownerId === ownerId);
  },
  remove: async (api: ApiClient, record: IOwnedRecord): Promise<void> => {
    const { instanceId } = await api.resolveInstance();
    if (!record.trashed) {
      await api.post(
        `/api/instances/${instanceId}/hubs/batch/delete`,
        { ids: [record.id] },
        z.unknown()
      );
    }
    await api.post(
      `/api/instances/${instanceId}/hubs/batch/delete_trashed`,
      { ids: [record.id] },
      z.unknown()
    );
  },
};

function quizRecord(quiz: z.infer<typeof quizRecordSchema>): IOwnedRecord {
  return {
    kind: "quiz",
    id: quiz.id,
    title: quiz.title ?? "",
    ownerId: quiz.user_id ?? null,
    createdAt: toDate(quiz.created_at),
    trashed: false,
  };
}

const quizGateway: IResourceGateway = {
  kind: "quiz",
  fetch: async (api: ApiClient, id: number): Promise<IOwnedRecord | null> => {
    const { workspaceId } = await api.resolveInstance();
    const quiz = await api.find(
      `/api/workspaces/${workspaceId}/quizzes/${id}`,
      quizRecordSchema
    );
    return quiz === null ? null : quizRecord(quiz);
  },
  listOwned: async (
    api: ApiClient,
    ownerId: number
  ): Promise<IOwnedRecord[]> => {
    const { workspaceId } = await api.resolveInstance();
    const quizzes = await readAllPages((page) =>
      api.getPage(
        `/api/workspaces/${workspaceId}/quizzes?user_ids%5B%5D=${ownerId}`,
        quizRecordSchema,
        page
      )
    );
    return quizzes
      .map(quizRecord)
      .filter((record) => record.ownerId === ownerId);
  },
  remove: async (api: ApiClient, record: IOwnedRecord): Promise<void> => {
    const { workspaceId } = await api.resolveInstance();
    await api.delete(`/api/workspaces/${workspaceId}/quizzes/${record.id}`);
  },
};

function learningPathRecord(
  learningPath: z.infer<typeof learningPathRecordSchema>
): IOwnedRecord {
  return {
    kind: "learning_path",
    id: learningPath.id,
    title: learningPath.title ?? "",
    ownerId: learningPath.owner_id ?? null,
    createdAt: toDate(learningPath.created_at),
    trashed: false,
  };
}

const learningPathGateway: IResourceGateway = {
  kind: "learning_path",
  fetch: async (api: ApiClient, id: number): Promise<IOwnedRecord | null> => {
    const learningPath = await api.find(
      `/api/instances/alias/${api.alias}/learning-paths/${id}`,
      learningPathRecordSchema
    );
    return learningPath === null ? null : learningPathRecord(learningPath);
  },
  listOwned: async (
    api: ApiClient,
    ownerId: number
  ): Promise<IOwnedRecord[]> => {
    const learningPaths = await readAllPages((page) =>
      api.getPage(
        `/api/instances/alias/${api.alias}/learning-paths`,
        learningPathRecordSchema,
        page
      )
    );
    return learningPaths
      .map(learningPathRecord)
      .filter((record) => record.ownerId === ownerId);
  },
  remove: async (api: ApiClient, record: IOwnedRecord): Promise<void> => {
    await api.delete(
      `/api/instances/alias/${api.alias}/learning-paths/${record.id}`
    );
  },
};

export const RESOURCE_GATEWAYS: Record<IResourceKind, IResourceGateway> = {
  course: courseGateway,
  quiz: quizGateway,
  learning_path: learningPathGateway,
};
