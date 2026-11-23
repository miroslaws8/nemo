import { z } from "zod";

const id = z.coerce.number().int().positive();

export const instanceSchema = z.object({
  id,
  workspace_id: id.optional(),
  workspace: z.object({ id }).optional(),
});

export const blankChatSchema = z.object({ chat_id: id, hub_id: id });

export const createdPageSchema = z.object({ id, hash: z.string().min(1) });

// A new blank course already has one section with a default page.
export const sectionsSchema = z.array(
  z.object({
    id,
    pages: z
      .array(
        createdPageSchema.extend({ title: z.string().nullable().optional() })
      )
      .default([]),
  })
);

export const assetConfigSchema = z.object({
  manual_only: z.array(z.string()).default([]),
});

const componentAssetSchema = z.object({
  id,
  type: z.string(),
  generation_status: z.string().nullable().optional(),
});

export type IComponentAsset = z.infer<typeof componentAssetSchema>;

export const pageComponentSchema = z.union([
  z.array(componentAssetSchema),
  z.object({ assets: z.array(componentAssetSchema) }),
  z.object({ components: z.array(componentAssetSchema) }),
]);

export const courseVariableSchema = z.object({
  hub_id: id,
  instance_id: id,
  section_id: id,
  page_id: id,
});

export const lastAssetVariableSchema = z.object({ id, type: z.string() });

export const authUserSchema = z.object({ id });

const ownerIdSchema = z.number().int().positive().nullable().optional();
const timestampSchema = z.string().nullable().optional();

export const courseRecordSchema = z.object({
  id,
  title: z.string().nullable(),
  owner_id: ownerIdSchema,
  created_at: timestampSchema,
  deleted_at: timestampSchema,
});

export const quizRecordSchema = z.object({
  id,
  title: z.string().nullable(),
  user_id: ownerIdSchema,
  created_at: timestampSchema,
});

export const learningPathRecordSchema = z.object({
  id,
  title: z.string().nullable(),
  owner_id: ownerIdSchema,
  created_at: timestampSchema,
});

export const createdQuizSchema = z.object({ id });

// A course in the instance's course list; `chat` is null for courses not built in the AI builder.
export const listedCourseSchema = z.object({
  id,
  title: z.string().nullable(),
  chat: z.object({ id }).nullable().optional(),
});
