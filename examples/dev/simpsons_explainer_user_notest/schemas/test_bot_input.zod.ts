import { z } from "npm:zod";

export default z.object({
  initialQuestion: z.string().describe(
    "Optional override for the scenario's first user question.",
  ).optional(),
});
