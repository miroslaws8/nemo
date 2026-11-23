import { z } from "zod";
import { findLastAssetId } from "./assets";
import { defineStep } from "./define-step";

// The engine only captures evidence: the screenshot and the question are recorded, and the
// Hermes /qa-test skill judges them with vision after the run. The test does not fail here.
export const aiCheckStep = defineStep({
  keyword: "ai_check",
  schema: z.string().min(5),
  describe: (question) => `ai_check: ${question}`,
  run: async (question, context) => {
    context.aiCheckCount += 1;
    const attachment = `ai-check-${context.aiCheckCount}`;
    const assetId = findLastAssetId(context);

    const screenshot =
      assetId === null
        ? await context.page.screenshot({ fullPage: true })
        : await context.page
            .locator(`[data-asset-id="${assetId}"]`)
            .screenshot();

    await context.testInfo.attach(attachment, {
      body: screenshot,
      contentType: "image/png",
    });
    context.testInfo.annotations.push({
      type: "ai_check",
      description: JSON.stringify({ question, attachment }),
    });
  },
});
