import type { IRegisteredStep, IStepDefinition } from "../types";

/** Wraps a typed step so the registry can hold every step behind one shape. */
export function defineStep<TArgs>(
  definition: IStepDefinition<TArgs>
): IRegisteredStep {
  return {
    keyword: definition.keyword,
    schema: definition.schema,
    createsData: definition.createsData ?? false,
    observesOnly: definition.observesOnly ?? false,
    describe: (args) => definition.describe(definition.schema.parse(args)),
    run: (args, context) =>
      definition.run(definition.schema.parse(args), context),
  };
}
