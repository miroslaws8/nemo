import type { IAiProtocolName, IModelProtocol } from "../../types";
import { anthropicProtocol } from "./anthropic";
import { openAiProtocol } from "./openai";

/** How the engine talks to a model, by the `protocol` of its role. A new one: a file and a line. */
export const MODEL_PROTOCOLS: Record<IAiProtocolName, IModelProtocol> = {
  openai: openAiProtocol,
  anthropic: anthropicProtocol,
};
