import { defineDeck } from "../../../mod.ts";
import { z } from "npm:zod@^3.23.8";

const inputSchema = z.object({
  reason: z.string(),
  urgency: z.enum(["routine", "soon", "urgent"]).default("routine"),
});

const outputSchema = z.object({
  instructions: z.string(),
  note: z.string(),
});

export default defineDeck({
  label: "transfer_request",
  inputSchema,
  outputSchema,
  run(ctx) {
    if (ctx.input.urgency === "urgent") {
      return {
        instructions:
          "Warm transfer to on-call nurse line at 415-555-0104 immediately.",
        note: `Reason: ${ctx.input.reason}`,
      };
    }
    return {
      instructions:
        "Create a callback ticket for the front desk queue; they respond within one business day.",
      note: `Reason logged: ${ctx.input.reason}`,
    };
  },
});
