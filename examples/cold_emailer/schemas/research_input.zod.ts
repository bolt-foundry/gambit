import { z } from "zod";

export default z.object({
  name: z.string().min(1).describe("Recipient name"),
  details: z.string().min(1).describe("Recipient context and pitch details"),
  products: z.array(z.string().min(1)).min(1).optional()
    .describe("Products or offerings to position in the email"),
});
