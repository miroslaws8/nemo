import type {
  IAiProtocolName,
  IAiSettings,
  IModelClient,
  IModelProtocol,
  IRunSpend,
} from "../types";
import { MODEL_PROTOCOLS } from "./protocols";

/** Why a model was not asked: its key is not set, or the run spent its AI budget. */
export class AiUnavailableError extends Error {
  constructor(readonly reason: "no_key" | "budget", message: string) {
    super(message);
  }
}

const PER_MILLION = 1_000_000;

/** The value of a key variable, "" when unset; null when the model takes no key. */
function keyOf(keyVariable: string | null): string | null {
  if (keyVariable === null) {
    return null;
  }
  return process.env[keyVariable]?.trim() ?? "";
}

/** A role's model (ai.models.<role>), with its key from the environment and the run's budget. */
export function createModelClient(
  settings: IAiSettings,
  role: string,
  spend: IRunSpend,
  protocols: Record<IAiProtocolName, IModelProtocol> = MODEL_PROTOCOLS
): IModelClient {
  const model = settings.models[role];
  if (model === undefined) {
    throw new Error(`No model "${role}" in ai.models`);
  }
  const protocol = protocols[model.protocol];
  return {
    role,
    model: model.model,
    async complete(request) {
      const apiKey = keyOf(model.keyVariable);
      if (apiKey === "") {
        throw new AiUnavailableError(
          "no_key",
          `${String(model.keyVariable)} is not set`
        );
      }
      const spent = spend.total();
      if (spent >= settings.budgetUsdPerRun) {
        throw new AiUnavailableError(
          "budget",
          `the run's AI budget is spent ($${spent.toFixed(2)} of $${
            settings.budgetUsdPerRun
          })`
        );
      }
      let reply;
      try {
        reply = await protocol.complete(model, apiKey, request);
      } catch (error) {
        // Provider errors end up in reports: never with the key in them.
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          apiKey === null || apiKey === ""
            ? message
            : message.split(apiKey).join("***")
        );
      }
      const usd =
        (reply.usage.inputTokens * model.usdPerMillion.input +
          reply.usage.outputTokens * model.usdPerMillion.output) /
        PER_MILLION;
      spend.add(usd, model.model);
      return reply;
    },
  };
}

/**
 * The judge's own model, when its key variable is unset, as a config error (CI stops on it). A
 * missing escalation key does not count: the judge skips a model it cannot ask.
 */
export function missingKeys(settings: IAiSettings): string[] {
  const role = settings.judge.model;
  const variable = settings.models[role]?.keyVariable ?? null;
  if (variable === null || keyOf(variable) !== "") {
    return [];
  }
  return [`ai.models.${role}.key: ${variable} is not set`];
}
