import { z } from "npm:zod@^3.23.8";

export default z.object({
  text: z.string().min(1).describe("Text to summarize"),
});
