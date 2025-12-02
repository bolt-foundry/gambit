import { z } from "zod";

export default z.object({
  name: z.string(),
  title: z.string(),
  yearsExperience: z.number().min(0),
  projects: z.array(z.string()).nonempty(),
  focus: z.string(),
});
