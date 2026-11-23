import { z } from "zod";
import { loadE2eConfig } from "../config";
import { RESOURCE_KINDS } from "../schema";
import { defineStep } from "./define-step";

// Data a test creates through the UI has no id the engine knows; registering its exact title lets
// cleanup find it among the test user's own records (name it with ${test.data_title}).
export const trackStep = defineStep({
  keyword: "track",
  schema: z.strictObject({
    kind: z.enum(RESOURCE_KINDS),
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
