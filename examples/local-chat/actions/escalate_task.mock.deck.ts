import { defineDeck } from "../../../mod.ts";
import { z } from "npm:zod";

export default defineDeck({
  label: "escalate_task_mock",
  contextSchema: z.object({
    reason: z.string().optional(),
    blocker: z.string().optional(),
  }).passthrough(),
  responseSchema: z.object({
    status: z.number(),
    mocked: z.boolean(),
    applied: z.boolean(),
    tool: z.literal("escalate_task"),
    reason: z.string(),
  }),
  run(ctx) {
    return {
      status: 200,
      mocked: true,
      applied: false,
      tool: "escalate_task",
      reason: ctx.input.reason ?? ctx.input.blocker ??
        "Escalation captured by mock tool.",
    };
  },
});
