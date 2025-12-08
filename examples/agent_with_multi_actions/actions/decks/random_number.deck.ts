import { defineDeck } from "../../../../mod.ts";
import { z } from "zod";

export default defineDeck({
  label: "random_number",
  inputSchema: z.object({
    min: z.number().optional().describe("Inclusive lower bound (default 0)"),
    max: z.number().optional().describe("Exclusive upper bound (default 100)"),
  }),
  outputSchema: z.object({
    value: z.number().describe("Random integer in [min, max)"),
    min: z.number(),
    max: z.number(),
  }),
  run(ctx) {
    const min = typeof ctx.input.min === "number" && Number.isFinite(ctx.input.min)
      ? ctx.input.min
      : 0;
    const max = typeof ctx.input.max === "number" && Number.isFinite(ctx.input.max)
      ? ctx.input.max
      : 100;
    const span = Math.max(1, Math.floor(max - min));
    const value = Math.floor(Math.random() * span) + min;
    return { value, min, max };
  },
});
