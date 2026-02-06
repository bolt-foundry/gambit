import { z } from "npm:zod";

export default z.object({
  changeSummary: z.string().describe(
    "Short summary of the change you are about to make.",
  ),
  userRequest: z.string().describe(
    "Original user ask, if available.",
  ).optional(),
  limit: z.number().int().min(1).max(5).default(3).describe(
    "Maximum number of policy docs to recommend.",
  ),
});
