import { z } from "npm:zod";

const matchSchema = z.object({
  question: z.string(),
  answer: z.string(),
});

export default z.object({
  matches: z.array(matchSchema),
});
