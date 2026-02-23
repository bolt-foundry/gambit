import { z } from "zod";

export default z.object({
  task: z.string().optional(),
});
