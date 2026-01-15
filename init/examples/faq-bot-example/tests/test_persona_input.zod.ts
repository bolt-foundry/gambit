import { z } from "npm:zod";

export default z.object({
  scenarioDescription: z.string().optional(),
  question: z.string().optional(),
});
