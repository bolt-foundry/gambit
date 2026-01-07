import { defineDeck } from "../../../mod.ts";
import { z } from "npm:zod@^3.23.8";

export default defineDeck({
  label: "error_simulator",
  inputSchema: z.object({
    reason: z.string().optional().describe("Optional test reason."),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
  }),
  run(ctx) {
    const reason = ctx.input.reason ?? "no reason provided";
    throw new Error(`Intentional error simulator failure: ${reason}`);
  },
});
