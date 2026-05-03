import { defineDeck } from "../../../mod.ts";
import { z } from "npm:zod";

export default defineDeck({
  label: "taxo_lookup_account_mock",
  contextSchema: z.object({
    customer: z.string().optional(),
    domain: z.string().optional(),
  }).passthrough(),
  responseSchema: z.object({
    status: z.number(),
    mocked: z.boolean(),
    applied: z.boolean(),
    account: z.object({
      id: z.string(),
      plan: z.string(),
      health: z.string(),
    }),
  }),
  run(ctx) {
    const key = ctx.input.customer ?? ctx.input.domain ?? "unknown";
    return {
      status: 200,
      mocked: true,
      applied: false,
      account: {
        id: `taxo-${key}`,
        plan: "representative",
        health: "ready_for_local_debug",
      },
    };
  },
});
