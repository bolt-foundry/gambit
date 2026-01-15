import { defineDeck } from "jsr:@bolt-foundry/gambit";
import { z } from "npm:zod";

export default defineDeck({
  label: "get_time",
  inputSchema: z.object({}),
  outputSchema: z.object({
    iso: z.string().describe("Current ISO timestamp"),
  }),
  run() {
    const iso = new Date().toISOString();
    return { iso };
  },
});
