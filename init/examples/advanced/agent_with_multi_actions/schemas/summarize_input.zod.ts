import { z } from "npm:zod";

export default z.object({
  text: z.string().min(1).describe("Text to summarize"),
});
