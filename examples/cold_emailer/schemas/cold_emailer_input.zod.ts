import { z } from "npm:zod@^3.23.8";

export default z.object({
  name: z.string().min(1).describe("Recipient name"),
  details: z.string().min(1).describe("Recipient context and pitch details"),
  sender: z.string().min(1).describe("Sender name for sign-off"),
  products: z.array(z.string().min(1)).min(1).optional()
    .describe("Products or offerings to position in the email"),
  voice: z.string().min(1).optional().describe("Target voice for the email"),
  voiceOptions: z.array(z.string().min(1)).min(1).optional()
    .describe("Available voice options to choose from"),
});
