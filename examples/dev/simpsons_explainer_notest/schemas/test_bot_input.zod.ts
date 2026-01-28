import { z } from "npm:zod";

export default z.object({
  initialQuestion: z.string().describe(
    "Optional override for the test bot's first user question.",
  ).optional(),
});
