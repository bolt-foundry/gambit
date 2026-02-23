import { z } from "zod";

export default z.object({
  step: z.string(),
  percent: z.number(),
});
