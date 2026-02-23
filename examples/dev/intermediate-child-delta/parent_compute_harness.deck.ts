import { defineDeck } from "../../../mod.ts";
import { z } from "zod";

export default defineDeck({
  contextSchema: z.string(),
  responseSchema: z.object({
    parent: z.literal("ok"),
    child: z.object({
      done: z.boolean(),
      task: z.string(),
    }),
  }),
  async run(ctx) {
    const child = await ctx.spawnAndWait({
      path: "./child_progress.deck.ts",
      input: { task: ctx.input },
    });
    return {
      parent: "ok",
      child: child as { done: boolean; task: string },
    };
  },
});
