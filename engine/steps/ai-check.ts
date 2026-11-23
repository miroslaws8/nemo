import { z } from "zod";
import { defineStep } from "./define-step";

// The engine only captures evidence: a screenshot of the whole page and the question are attached
// to the test (annotation "ai_check") for a person or a vision model to judge after the run.
// The test does not fail here.
export const aiCheckStep = defineStep({
  keyword: "ai_check",
  schema: z.string().min(5),
  describe: (question) => `ai_check: ${question}`,
  run: async (question, context) => {
    context.aiCheckCount += 1;
    const attachment = `ai-check-${context.aiCheckCount}`;
    const screenshot = await context.page.screenshot({ fullPage: true });

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
