import { z } from "zod";
import { loadE2eConfig } from "../config";
import { GATEWAYS_BY_KIND } from "../cleanup/gateways";
import { defineStep } from "./define-step";

// Data a test creates through the UI has no id the engine knows; registering its exact title lets
// cleanup find it among the test user's own records (name it with ${test.data_title}).
export const trackStep = defineStep({
  keyword: "track",
  schema: z.strictObject({
    // A kind of record engine/cleanup/gateways.ts knows how to find and delete.
    kind: z
      .string()
      .min(1)
      .refine(
        (kind) => GATEWAYS_BY_KIND.has(kind),
        "no resource gateway of this kind (engine/cleanup/gateways.ts)"
      ),
    title: z.string().min(1),
  }),
  createsData: true,
  describe: (args) => `track ${args.kind} "${args.title}" for cleanup`,
  run: async (args, context) => {
    const prefix = loadE2eConfig().safety.data_prefix;
    if (!args.title.startsWith(prefix)) {
      throw new Error(
        `track: "${args.title}" does not start with "${prefix}" — name test data with \${test.data_title}`
      );
    }
    context.resources.track({
      kind: args.kind,
      id: null,
      title: args.title,
      url: null,
    });
  },
});
