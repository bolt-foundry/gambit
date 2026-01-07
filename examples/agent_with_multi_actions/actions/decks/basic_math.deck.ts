import { defineDeck } from "jsr:@bolt-foundry/gambit";
import { z } from "npm:zod@^3.23.8";

const opEnum = z.enum(["add", "subtract", "multiply", "divide"]);

export default defineDeck({
  label: "basic_math",
  inputSchema: z.object({
    a: z.number().describe("First operand"),
    b: z.number().describe("Second operand"),
    op: opEnum.default("add").describe("Operation to perform"),
  }),
  outputSchema: z.object({
    result: z.number(),
    op: opEnum,
  }),
  run(ctx) {
    const { a, b, op } = ctx.input;
    switch (op) {
      case "add":
        return { result: a + b, op };
      case "subtract":
        return { result: a - b, op };
      case "multiply":
        return { result: a * b, op };
      case "divide":
        return { result: b === 0 ? Infinity : a / b, op };
      default:
        return { result: NaN, op };
    }
  },
});
