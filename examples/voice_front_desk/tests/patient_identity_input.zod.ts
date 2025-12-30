import { z } from "zod";

export default z.object({
  firstName: z.string().optional().default("Jordan"),
  lastName: z.string().optional().default("Lee"),
  dob: z.string().optional().default("1992-11-03"),
  phone: z.string().optional().default("555-0122"),
  scenarioDescription: z.string().describe(
    "Optional instructions that describe the persona scenario",
  ).optional(),
});
