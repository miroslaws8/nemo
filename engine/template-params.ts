import { z } from "zod";
import { durationSchema } from "./schema";
import type { ITemplateParamType } from "./types";

const PARAM_VALUE_SCHEMAS: Record<ITemplateParamType, z.ZodType> = {
  string: z.string(),
  number: z.number(),
  boolean: z.boolean(),
  duration: durationSchema,
};

export function paramValueSchema(type: ITemplateParamType): z.ZodType {
  return PARAM_VALUE_SCHEMAS[type];
}
