import { z } from "zod";

export default z.object({
  scenarioDescription: z.string().describe(
    "Optional instructions that describe the new patient intake scenario",
  ).optional(),
});
