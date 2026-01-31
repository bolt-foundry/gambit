import { defineDeck } from "jsr:@molt-foundry/gambit";
import { z } from "npm:zod";

export default defineDeck({
  label: "get_time",
  contextSchema: z.object({}),
  responseSchema: z.object({
    iso: z.string().describe("Current ISO timestamp"),
  }),
  run() {
    const iso = new Date().toISOString();
    return { iso };
  },
});
