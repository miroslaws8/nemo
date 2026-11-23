import type { PipeTransform } from "@nestjs/common";
import { z } from "zod";
import { HttpError } from "../http-error";

/**
 * Validates a request body with a schema of the HTTP contract (console/shared/api.ts), the same
 * one the web app checks with: `@Body(new ZodBodyPipe(startRunRequestSchema))`.
 */
export class ZodBodyPipe<TSchema extends z.ZodType>
  implements PipeTransform<unknown, z.infer<TSchema>>
{
  constructor(private readonly schema: TSchema) {}

  transform(value: unknown): z.infer<TSchema> {
    const parsed = this.schema.safeParse(value);
    if (!parsed.success) {
      throw new HttpError(400, z.prettifyError(parsed.error));
    }
    return parsed.data;
  }
}
