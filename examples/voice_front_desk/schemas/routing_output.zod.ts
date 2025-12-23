import { z } from "zod";

export default z.object({
  intent: z.string().describe("Classifier for the caller's request"),
  reason: z.string().describe("Short summary of what the caller needs"),
  targetDeck: z.string().describe("Name of the action deck to call next"),
  urgency: z.enum(["urgent", "soon", "routine"]).default("routine"),
});
