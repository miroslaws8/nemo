import Anthropic from "@anthropic-ai/sdk";
import type { IModelPart, IModelProtocol } from "../../types";

// The Anthropic Messages API. No thinking or sampling settings: models differ in which they
// accept, and the defaults suit a short judgement.

function contentBlock(part: IModelPart): Anthropic.ContentBlockParam {
  return part.type === "text"
    ? { type: "text", text: part.text }
    : {
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: part.png.toString("base64"),
        },
      };
}

export const anthropicProtocol: IModelProtocol = {
  async complete(settings, apiKey, request, fetchImpl) {
    const client = new Anthropic({
      apiKey,
      // Explicit, so the SDK's own variables (ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN) never send
      // the key or the screenshots anywhere the config does not name.
      authToken: null,
      baseURL: settings.baseUrl ?? "https://api.anthropic.com",
      timeout: request.timeoutMs,
      fetch: fetchImpl,
      // One retry for a transient error; the judge's own re-checks do the rest.
      maxRetries: 1,
    });
    const message = await client.messages.create({
      model: settings.model,
      max_tokens: request.maxTokens,
      system: request.system,
      messages: [{ role: "user", content: request.parts.map(contentBlock) }],
    });
    const text = message.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("");
    return {
      text,
      usage: {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
      },
      refused: message.stop_reason === "refusal",
    };
  },
};
