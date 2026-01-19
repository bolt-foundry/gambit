import { z } from "npm:zod";

export default z.object({
  draft: z.string().min(1).describe("Email draft to critique"),
  targetVoice: z.string().min(1).describe("Target voice to evaluate"),
  voiceOptions: z.array(z.string().min(1)).min(1).optional()
    .describe("Available voice options"),
});
