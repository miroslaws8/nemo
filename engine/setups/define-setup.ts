import type { IRegisteredSetup, ISetupDefinition } from "../types";

/** Wraps a typed setup so the registry can hold every setup behind one shape. */
export function defineSetup<TParams>(
  definition: ISetupDefinition<TParams>
): IRegisteredSetup {
  return {
    name: definition.name,
    mode: definition.mode,
    params: definition.params,
    run: (args, context) =>
      definition.run(definition.params.parse(args), context),
  };
}
