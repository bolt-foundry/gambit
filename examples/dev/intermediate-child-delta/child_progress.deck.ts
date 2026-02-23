import { defineDeck } from "../../../mod.ts";
import { z } from "zod";

export default defineDeck({
  contextSchema: z.object({
    task: z.string().default("unspecified-task"),
  }),
  responseSchema: z.object({
    done: z.boolean(),
    task: z.string(),
  }),
  responseItemExtensions: [
    {
      type: "gambit:action_progress",
      dataSchema: z.object({
        step: z.string(),
        percent: z.number(),
      }),
      description: "Intermediate child progress updates",
    },
  ],
  async run(ctx) {
    await ctx.emitOutputItem({
      type: "gambit:action_progress",
      data: { step: "start", percent: 10 },
    });
    await new Promise((resolve) => setTimeout(resolve, 15));
    await ctx.emitOutputItem({
      type: "gambit:action_progress",
      data: { step: "middle", percent: 60 },
    });
    await new Promise((resolve) => setTimeout(resolve, 15));
    await ctx.emitOutputItem({
      type: "gambit:action_progress",
      data: { step: "finalizing", percent: 90 },
    });
    return {
      done: true,
      task: ctx.input.task,
    };
  },
});
