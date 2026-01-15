import { z } from "npm:zod@^3.23.8";

export default z.object({
  scenarioDescription: z.string().optional(),
  question: z.string().optional(),
});
