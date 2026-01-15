import { defineDeck } from "jsr:@bolt-foundry/gambit";
import { z } from "npm:zod";

const sourceSchema = z.object({
  deckPath: z.string(),
  actionName: z.string(),
});

const handler = defineDeck({
  label: "on_error_handler_ts",
  inputSchema: z.object({
    kind: z.literal("error"),
    label: z.string().optional(),
    source: sourceSchema,
    error: z.object({ message: z.string() }),
    childInput: z.record(z.unknown()).optional(),
  }),
  outputSchema: z.object({
    message: z.string().optional(),
    code: z.string().optional(),
    status: z.number().optional(),
    meta: z.record(z.unknown()).optional(),
    payload: z.unknown().optional(),
  }),
  run(ctx) {
    const { source, error } = ctx.input;
    const fallback =
      `I couldn't complete ${source.actionName}, but I handled the error. Please try again with different input.`;
    return {
      message: "Recovered from an error gracefully (TS).",
      code: "TS_HANDLED_FALLBACK",
      status: 200,
      meta: { deck: source.deckPath },
      payload: { notice: fallback, error: error.message },
    };
  },
});

export default handler;
