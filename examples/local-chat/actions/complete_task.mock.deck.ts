import { defineDeck } from "../../../mod.ts";
import { z } from "npm:zod";

export default defineDeck({
  label: "complete_task_mock",
  contextSchema: z.object({
    summary: z.string().optional(),
  }).passthrough(),
  responseSchema: z.object({
    status: z.number(),
    mocked: z.boolean(),
    applied: z.boolean(),
    tool: z.literal("complete_task"),
    summary: z.string(),
  }),
  run(ctx) {
    return {
      status: 200,
      mocked: true,
      applied: false,
      tool: "complete_task",
      summary: ctx.input.summary ?? "Task completion captured by mock tool.",
    };
  },
});
