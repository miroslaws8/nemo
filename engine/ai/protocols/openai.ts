import OpenAI from "openai";
import type { IModelPart, IModelProtocol } from "../../types";

// The OpenAI-compatible Chat Completions API: OpenAI itself, and the servers that speak it
// (Gemini's OpenAI endpoint, OpenRouter, Ollama, vLLM, LM Studio, …) through base_url. No token
// limit is sent: servers disagree on its name, and a judge's answer is short.

function contentPart(
  part: IModelPart
): OpenAI.Chat.Completions.ChatCompletionContentPart {
  return part.type === "text"
    ? { type: "text", text: part.text }
    : {
        type: "image_url",
        image_url: {
          url: `data:image/png;base64,${part.png.toString("base64")}`,
        },
      };
}

export const openAiProtocol: IModelProtocol = {
  async complete(settings, apiKey, request, fetchImpl) {
    const client = new OpenAI({
      // A local server takes no key, but the client wants one.
      apiKey: apiKey ?? "none",
      baseURL: settings.baseUrl ?? undefined,
      fetch: fetchImpl,
      // One retry for a transient error; the judge's own re-checks do the rest.
      maxRetries: 1,
    });
    const completion = await client.chat.completions.create({
      model: settings.model,
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: request.parts.map(contentPart) },
      ],
    });
    const message = completion.choices[0]?.message;
    return {
      text: message?.content ?? "",
      usage: {
        inputTokens: completion.usage?.prompt_tokens ?? 0,
        outputTokens: completion.usage?.completion_tokens ?? 0,
      },
      refused: Boolean(message?.refusal),
    };
  },
};
