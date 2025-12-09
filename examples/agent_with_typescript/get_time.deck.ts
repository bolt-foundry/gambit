import { defineDeck } from "../../mod.ts";
import { z } from "zod";

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
