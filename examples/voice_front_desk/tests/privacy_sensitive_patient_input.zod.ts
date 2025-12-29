import { z } from "zod";

export default z.object({
  scenarioDescription: z.string().describe(
    "Optional instructions that describe the scenario the test bot should play out",
  ).optional(),
});
