import OpenAI from "openai";
import type {
  IModelMessage,
  IModelPart,
  IModelProtocol,
  IModelToolCall,
} from "../../types";

// The OpenAI-compatible Chat Completions API: OpenAI itself, and the servers that speak it
// (Gemini's OpenAI endpoint, OpenRouter, Ollama, vLLM, LM Studio, …) through base_url. No token
// limit is sent: servers disagree on its name, and the answers asked for are short.

type IChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

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

const MESSAGES: {
  [TRole in IModelMessage["role"]]: (
    message: Extract<IModelMessage, { role: TRole }>
  ) => IChatMessage[];
} = {
  user: (message) => [
    { role: "user", content: message.parts.map(contentPart) },
  ],
  assistant: (message) => [
    {
      role: "assistant",
      content: message.text === "" ? null : message.text,
      ...(message.toolCalls.length === 0
        ? {}
        : {
            tool_calls: message.toolCalls.map((call) => ({
              id: call.id,
              type: "function" as const,
              function: {
                name: call.name,
                arguments:
                  typeof call.input === "string"
                    ? call.input
                    : JSON.stringify(call.input),
              },
            })),
          }),
    },
  ],
  tool: (message) =>
    message.results.map((result) => ({
      role: "tool" as const,
      tool_call_id: result.callId,
      content: result.text,
    })),
};

function chatMessages(message: IModelMessage): IChatMessage[] {
  switch (message.role) {
    case "user":
      return MESSAGES.user(message);
    case "assistant":
      return MESSAGES.assistant(message);
    case "tool":
      return MESSAGES.tool(message);
    default: {
      const unknownMessage: never = message;
      return unknownMessage;
    }
  }
}

function parsedArguments(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export const openAiProtocol: IModelProtocol = {
  async complete(settings, apiKey, request, fetchImpl) {
    const client = new OpenAI({
      // A local server takes no key, but the client wants one.
      apiKey: apiKey ?? "none",
      // Explicit, so the SDK's own variables (OPENAI_BASE_URL, OPENAI_ORG_ID, …) never send the
      // key or the screenshots anywhere the config does not name.
      baseURL: settings.baseUrl ?? "https://api.openai.com/v1",
      organization: null,
      project: null,
      timeout: request.timeoutMs,
      fetch: fetchImpl,
      // One retry for a transient error; the callers re-ask themselves.
      maxRetries: 1,
    });
    const completion = await client.chat.completions.create({
      ...settings.params,
      model: settings.model,
      messages: [
        { role: "system", content: request.system },
        ...request.messages.flatMap(chatMessages),
      ],
      ...(request.tools.length === 0
        ? {}
        : {
            tools: request.tools.map((tool) => ({
              type: "function" as const,
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.schema,
              },
            })),
          }),
    });
    const message = completion.choices[0]?.message;
    const toolCalls: IModelToolCall[] = (message?.tool_calls ?? []).flatMap(
      (call) =>
        call.type === "function"
          ? [
              {
                id: call.id,
                name: call.function.name,
                input: parsedArguments(call.function.arguments),
              },
            ]
          : []
    );
    return {
      text: message?.content ?? "",
      toolCalls,
      usage: {
        inputTokens: completion.usage?.prompt_tokens ?? 0,
        outputTokens: completion.usage?.completion_tokens ?? 0,
      },
      refused: Boolean(message?.refusal),
    };
  },
};
