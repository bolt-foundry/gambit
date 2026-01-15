import { z } from "npm:zod@^3.23.8";

const matchSchema = z.object({
  question: z.string(),
  answer: z.string(),
});

export default z.object({
  matches: z.array(matchSchema),
});
