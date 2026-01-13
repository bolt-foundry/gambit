import { z } from "npm:zod@^3.23.8";

export default z.object({
  initialQuestion: z.string().describe(
    "Optional override for the test bot's first user question.",
  ).optional(),
});
