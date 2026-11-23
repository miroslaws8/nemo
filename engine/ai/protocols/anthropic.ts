import Anthropic from "@anthropic-ai/sdk";
import type {
  IModelMessage,
  IModelPart,
  IModelProtocol,
  IModelToolCall,
} from "../../types";

// The Anthropic Messages API. No thinking or sampling settings: models differ in which they
// accept, and the defaults suit short answers and tool calls.

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

function apiMessage(message: IModelMessage): Anthropic.MessageParam {
  switch (message.role) {
    case "user":
      return { role: "user", content: message.parts.map(contentBlock) };
    case "assistant":
      return {
        role: "assistant",
        content: [
          ...(message.text === ""
            ? []
            : [{ type: "text" as const, text: message.text }]),
          ...message.toolCalls.map((call) => ({
            type: "tool_use" as const,
            id: call.id,
            name: call.name,
            input: call.input,
          })),
        ],
      };
    case "tool":
      // Tool results go back as a user turn; the observation that follows (also a user turn) is
      // merged into it by the API.
      return {
        role: "user",
        content: message.results.map((result) => ({
          type: "tool_result" as const,
          tool_use_id: result.callId,
          content: result.text,
        })),
      };
    default: {
      const unknownMessage: never = message;
      return unknownMessage;
    }
  }
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
      // One retry for a transient error; the callers re-ask themselves.
      maxRetries: 1,
    });
    const message = await client.messages.create({
      model: settings.model,
      max_tokens: request.maxTokens,
      system: request.system,
      messages: request.messages.map(apiMessage),
      ...(request.tools.length === 0
        ? {}
        : {
            tools: request.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              input_schema: { type: "object" as const, ...tool.schema },
            })),
          }),
    });
    const text = message.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("");
    const toolCalls: IModelToolCall[] = message.content.flatMap((block) =>
      block.type === "tool_use"
        ? [{ id: block.id, name: block.name, input: block.input }]
        : []
    );
    return {
      text,
      toolCalls,
      usage: {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
      },
      refused: message.stop_reason === "refusal",
    };
  },
};
