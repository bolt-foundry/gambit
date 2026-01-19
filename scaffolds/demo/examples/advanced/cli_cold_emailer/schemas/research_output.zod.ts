import { z } from "npm:zod";

export default z.object({
  highlights: z.array(z.string().min(1))
    .describe("Most relevant insights to use in the email"),
  trends: z.array(z.string().min(1)).optional()
    .describe("Relevant market trends to optionally mention"),
  openQuestions: z.array(z.string().min(1))
    .describe("Missing details needed to write a stronger email"),
});
