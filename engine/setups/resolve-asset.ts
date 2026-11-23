import { z } from "zod";
import { assetConfigSchema } from "../api-schemas";
import type { IRunContext } from "../types";
import { defineSetup } from "./define-setup";

const assetRowSchema = z.looseObject({
  type: z.string().min(1),
  ai: z.boolean(),
});

// The data row declares whether the type is AI-generated and the backend's manual_only list must
// agree, so a backend change can never make a credit-free tier start spending credits unnoticed.
async function resolveAsset(
  _params: Record<string, never>,
  context: IRunContext
): Promise<void> {
  const row = assetRowSchema.safeParse(context.variables.asset);
  if (!row.success) {
    throw new Error(
      "resolve_asset needs an `asset` row with `type` and `ai` (true/false) — use each: { as: asset, from: data/... }"
    );
  }

  const config = await context.api.get(
    "/api/common/asset-config",
    assetConfigSchema
  );
  const generatedByAi = !config.manual_only.includes(row.data.type);
  if (generatedByAi !== row.data.ai) {
    const backendMode = generatedByAi ? "AI-generated" : "manual-only";
    throw new Error(
      `${row.data.type}: the data row says ai: ${row.data.ai}, but the backend treats it as ${backendMode} — move the row to the data file for that mode`
    );
  }
}

export const resolveAssetSetup = defineSetup({
  name: "resolve_asset",
  mode: "readonly",
  params: z.strictObject({}),
  run: resolveAsset,
});
