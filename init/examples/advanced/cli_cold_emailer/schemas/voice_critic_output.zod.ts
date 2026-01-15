import { z } from "npm:zod@^3.23.8";

export default z.object({
  issues: z.array(z.string().min(1)).describe("Voice mismatches or problems"),
  suggestions: z.array(z.string().min(1))
    .describe("Concrete rewrite guidance"),
});
