import { z } from "zod";

export default z.union([
  z.string().min(1).describe("Natural language request"),
  z.object({
    goal: z.string().min(1).optional().describe("What the user wants to build"),
    notes: z.string().optional().describe("Extra context or constraints"),
    userFirst: z.boolean().optional().describe("If true, user wants to speak first"),
  }),
]);
