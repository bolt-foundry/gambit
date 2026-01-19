import { z } from "npm:zod";

export default z.object({
  query: z.string().min(3, "Provide a question to search"),
  maxResults: z.number().int().min(1).max(8).optional(),
});
